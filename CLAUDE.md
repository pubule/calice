# Note per sessioni future

## Ponytail sempre attivo (anche nel cloud)

Richiesta esplicita dell'utente. Sul suo PC Ponytail è un plugin che si
attiva da solo; nel cloud i plugin non si installano, quindi le sue sei skill
sono copiate in `.claude/skills/ponytail*` (MIT, `LICENSE` in `ponytail/`, da
github.com/DietrichGebert/ponytail @09c434a). In ogni sessione segui la skill
`ponytail` a livello **full** per ogni compito di codice. Per aggiornarle:
ricopiare la cartella `skills/` del repo originale.

## Handoff: aggiornarlo a ogni push

`HANDOFF.md` (root del repo) è il riassunto "dove eravamo rimasti" per chi
riprende il progetto — stato attuale, lavoro recente, cose note da non
rifare, prossimi passi. **Prima di ogni push** (che sia su `master` o su
un branch di lavoro), aggiornarlo perché rifletta lo stato dopo quel push:
cosa è cambiato in questa sessione, eventuali decisioni/trade-off presi,
cosa resta aperto. Non è un changelog di ogni commit — è lo snapshot
utile a chi (o quale sessione) arriva dopo, quindi riscrivere/potare le
sezioni superate invece di limitarsi ad aggiungere in fondo.

## PWA su iOS: status bar / viewport — stato in evoluzione, leggere questa nota per intero prima di toccare

`public/index.html`'s `apple-mobile-web-app-status-bar-style` è tornato su
**`black-translucent`** (era `default` fino a poco fa). Cronologia completa:

1. **3 settembre** (commit `d0d2bd8`): `black-translucent` provato e
   revertato a `default` — osservato uno "scrim scuro" sulla barra di
   stato, giudicato peggio della barra grigio chiara di `default`.
2. **Questa sessione, primo tentativo**: rifatto lo stesso passaggio a
   `black-translucent` senza saperlo (non avevo ancora letto la storia),
   causando anche una fascia nera in fondo allo schermo — il blocco
   `visualViewport` in `main.js` non era mai stato testato in
   combinazione con `black-translucent`/edge-to-edge, e in quella
   modalità `visualViewport.height` diverge da `window.innerHeight`
   anche a riposo.
3. **Rivalutazione**: revertato tutto a `default`, poi trovato e risolto
   un bug distinto (vedi sotto) nel blocco `visualViewport` — non
   legato allo status bar in sé, ma che si manifestava come zona
   grigia/gap di contenuto al cold-launch e al resume da background.
4. **Riprova consapevole di `black-translucent`**: col bug del punto 3
   ormai risolto (l'override di `--app-top`/`--app-height` scatta solo
   con un input davvero a fuoco — vedi sotto), è plausibile che lo
   "scrim scuro" osservato sia sempre stato **quello stesso bug di
   contenuto**, non un'imposizione reale di iOS — né il 3 settembre né
   il tentativo di questa sessione lo avevano mai escluso, perché
   nessuno dei due aveva ancora isolato il bug. Verificato in locale
   (Playwright) che `.screen` resta a `top:0`/altezza piena sia a
   riposo sia dopo eventi resize/scroll simulati senza focus — ma
   Playwright headless **non riproduce la resa reale della status bar
   iOS**, quindi questo va confermato su device reale.
5. **Vincolo che resta comunque fisso**, qualunque cosa succeda: in
   `black-translucent` iOS forza le icone della barra (ora/batteria/
   segnale) in bianco — nessun modo di sceglierle scure. Se lo sfondo
   sotto risulta davvero crema ma il contrasto delle icone bianche non
   convince, quello è il limite reale e non altro codice da scrivere;
   a quel punto la scelta è tra questo trade-off e tornare a `default`.

**Prima di ritoccare uno dei due**: `git log --oneline -i --grep="status.bar\|viewport\|safe-area\|black-translucent"`
— leggere tutti i tentativi precedenti (da `3a8468a` in poi) prima di
cambiare ancora, e soprattutto non giudicare `black-translucent` da solo
senza aver prima verificato lo stato del blocco `visualViewport` sotto.

### Bug distinto: zona grigia al cold-launch E al resume da background

Anche in `status-bar-style: default` (quello giusto, sopra) restava una
zona grigia in alto, che spariva da sola aprendo e richiudendo la
tastiera. Prima diagnosi (incompleta): solo al cold-launch da icona
Home, causa la chiamata eager `applyViewportHeight()` al load che
leggeva `visualViewport.offsetTop` prima che iOS l'avesse assestato.
Rimossa quella chiamata eager — ma il bug è **ricomparso**, stavolta
al resume dell'app da background (switch ad altre app e ritorno), non
al cold-launch.

Causa vera, più a monte: i listener `resize`/`scroll` su
`visualViewport` restano attivi per tutta la vita della pagina, e
quegli eventi non sparano solo quando si apre la tastiera — sparano
anche al cold-launch E ogni volta che la PWA standalone torna in
foreground da background, e in entrambi i casi iOS può riportare
valori transitori/non ancora assestati. La sola rimozione della
chiamata eager copriva il cold-launch ma non gli eventi successivi con
valori sbagliati durante il resume.

**Fix definitivo**: applicare l'override di `--app-top`/`--app-height`
solo quando c'è davvero un `input`/`textarea` con `document.activeElement`
— l'unico segnale vero che la tastiera sia genuinamente aperta, a
differenza di dedurlo dalla sola variazione di `visualViewport.height`
(fragile, dipende da soglie in pixel e dal timing di iOS). Cold-launch,
resume da background, rotazione: nessuno di questi ha un input attivo,
quindi cadono sempre nel ramo che lascia `.screen` sul suo default CSS
(`top:0`/`bottom:0`, vedi sezione sotto).

### L'override per tastiera non deve mai sopravvivere alla tastiera

Build 109: dopo aver aggiunto un vino l'app è rimasta tagliata
all'altezza della tastiera, con il menu a metà schermo. Due cause
sovrapposte: (1) la finestra "Quante bottiglie?" (`modal.js`) si chiudeva
lasciando a fuoco il suo campo, ormai invisibile, quindi per `main.js`
"si stava ancora scrivendo"; (2) l'override si ricalcolava **solo** sugli
eventi di `visualViewport`, e iOS non garantisce un ultimo `resize`
quando la tastiera sparisce. Regole, ora in `main.js`:
- "Sto scrivendo" = `isLiveField()`: campo a fuoco, visibile, **non dentro
  un foglio chiuso** (i fogli restano nel DOM).
- Chiudere un foglio toglie il fuoco ai suoi campi: lo fa un unico
  `MutationObserver` su ogni perdita della classe `open`, così un foglio
  nuovo non può dimenticarlo.
- Ricalcolo anche su `focusout` (subito, 350 ms, 800 ms), `pageshow` e
  `visibilitychange`, non solo sugli eventi del viewport.
- `.screen` stessa non scorre mai (`overflow:hidden`, ma il browser può
  comunque spostarla per mostrare un cursore): un listener `scroll` in
  `main.js` la riporta a 0. Scorrono solo le viste e i fogli dentro.

### La "fascia nera in fondo": NON era canvas non dipinto — era `body` in dark mode

Questa è stata diagnosticata male per settimane (dal 2 settembre in poi),
quindi vale la pena essere espliciti: **la fascia scura in fondo allo
schermo non è mai stata "canvas nativo non dipinto"**. È il background di
`body`, che era l'unico elemento dell'app a reagire a
`prefers-color-scheme: dark`:

```css
/* com'era — RIMOSSO */
:root{ --page-bg:#f4f2ee; ... }
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ --page-bg:#111011; ... } }
body{ ...; background:var(--page-bg); }
```

Prova: campionando il pixel della fascia in uno screenshot del device
risulta `rgb(16,16,16)`, cioè **`#111011`** — esattamente `--page-bg` in
dark mode, non `#000000`. L'utente ha il telefono in modalità scura,
quindi ogni striscia che `.screen` non copriva veniva dipinta quasi nera
e sembrava un buco nel rendering.

Il resto dell'app non ha alcun tema scuro: `html` è `color-scheme:light`
con sfondo crema fisso e `.screen` ha `background:#f7f5f0` hardcoded. Le
quattro variabili `--page-*` erano usate **solo** per lo sfondo di `body`
e per nient'altro (nessun toggle di tema in tutto il JS) — quindi erano
puro debito: l'unico loro effetto pratico era rendere visibile,
in nero, qualsiasi errore di altezza di `.screen`.

**Fix (parte 1 — rende il sintomo impossibile)**: variabili `--page-*` e
blocchi dark-mode eliminati; `body` ha lo stesso crema fisso di `html` e
`.screen`. Anche se in futuro `.screen` sbagliasse di qualche pixel,
adesso il divario è crema e invisibile invece che nero.

### `.screen`: niente unità di altezza, si stira tra `top:0` e `bottom:0`

Storico dei tentativi, tutti sullo stesso punto (l'altezza di `.screen`)
e tutti falliti perché misuravano il sintomo sbagliato (vedi sopra):

| quando | valore | esito su device |
|---|---|---|
| 2 set (`9d64542`) | `100dvh` → `100%`/`-webkit-fill-available` | corretto **in `status-bar-style: default`** |
| `7d0c953` | tornato a `var(--app-height, 100dvh)` | regressione silenziosa |
| questa sessione | `var(--app-height, 100%)`/`var(..., -webkit-fill-available)` | **peggiorato** |
| questa sessione | `100%`/`-webkit-fill-available` piani | identico al precedente, pixel per pixel |

Le ultime due righe sono la chiave: gli screenshot dei due tentativi sono
risultati **identici pixel per pixel** (verificato campionando le
transizioni di colore), il che dimostra che `-webkit-fill-available`
risolveva benissimo in entrambi i casi — solo che risolveva al valore
**sbagliato**: `.screen` alta 734pt su uno schermo da 852pt, ~118pt
corti. Quindi la teoria del "bug di WebKit nei fallback di `var()`" era
sbagliata, e anche il fix del 2 settembre non era universalmente valido:
era corretto **in `status-bar-style: default`**, non in
`black-translucent` + `viewport-fit=cover`, dove il viewport è
edge-to-edge e le due unità risolvono diversamente.

**Fix (parte 2 — causa radice)**: `.screen` non usa più **nessuna** unità
di altezza. Si stira tra i due bordi:
```css
.screen{ position:fixed; top:0; bottom:0; /* niente height */ ... }
```
Un elemento `position:fixed` con `top` e `bottom` entrambi a 0 e
`height:auto` riempie esattamente il containing block iniziale senza
risolvere nessuna lunghezza — quindi non può sbagliare come hanno
sbagliato `100dvh` e `-webkit-fill-available`, ciascuno in una modalità
diversa. L'override per tastiera aperta (`main.js`) imposta inline `top`
e `height` su `.screen`: la scatola diventa sovra-vincolata e `bottom`
viene ignorato per quella durata, che è esattamente l'intento; rimuovendo
i due valori inline si torna allo stiramento.

**Regole da non violare in questo progetto**:
- Mai `100dvh` né `-webkit-fill-available` per l'altezza di `.screen`:
  risolvono contro la viewport corta (vedi sezione successiva), quindi
  danno tutti lo stesso risultato sbagliato.
- Mai allungare `.screen` oltre il bordo inferiore della viewport: iOS
  non dipinge nulla lì (provato e revertato, vedi sezione dedicata).
- Mai togliere `@media (display-mode: standalone){ .navbar{ padding-bottom:2px } }`:
  con la viewport corta l'home indicator sta fuori dalla viewport, quindi
  riservargli spazio nella navbar aggiunge solo vuoto.
- Mai reintrodurre un background dipendente da `prefers-color-scheme` su
  `html`/`body`: l'app è light-only e quello è l'unico motivo per cui un
  errore di layout diventava una fascia nera visibile.
- Prima di teorizzare sul perché una zona non è dipinta, **campionare il
  colore del pixel** in uno screenshot del device: distingue in un colpo
  solo tra canvas nativo (`#000000`) e un elemento dell'app dipinto male.

### La causa radice: in `black-translucent` la viewport è più corta dello schermo

**Questa sezione sostituisce una diagnosi precedente sbagliata** (che
`env(safe-area-inset-bottom)` fosse "gonfiato" a ~94pt). Non lo è: sul
device riporta **34**, il valore giusto. Numeri letti direttamente
dall'iPhone 15 Pro tramite la riga diagnostica in Profilo:

```
win 793 · vv 793 · screen 0→793 · nav h83 pb36px · inset top 59 bottom 34
```

Lo schermo è **852pt**, ma `window.innerHeight` è **793** = 852 − 59,
cioè manca esattamente l'inset superiore. È il difetto noto di
`apple-mobile-web-app-status-bar-style: black-translucent`: iOS sposta
l'origine della viewport a y=0, così il contenuto disegna sotto la status
bar, **ma le lascia l'altezza che avrebbe avuto sotto la status bar**.
Quei 59pt cadono fuori in fondo allo schermo.

`.screen` riempiva già perfettamente quella viewport (`0→793`) — non ha
mai avuto un bug di altezza. Semplicemente la viewport finisce 59pt sopra
il fondo fisico. Ecco perché **ogni** tentativo precedente falliva:
`100dvh`, `-webkit-fill-available` e `top:0/bottom:0` risolvono tutti
contro quella stessa viewport corta, quindi davano tutti lo stesso
risultato sbagliato. Non era la scelta dell'unità.

**Tentativo fallito, da non ripetere**: allungare `.screen` oltre il bordo
della viewport con `bottom:calc(-1 * env(safe-area-inset-top))`.
Geometricamente torna (793 + 59 = 852) ma **iOS non dipinge niente sotto
il bordo della viewport**: la navbar finiva nella striscia non disegnata,
le etichette sparivano e le icone venivano tagliate a metà glifo
(verificato: il contenuto si interrompeva di netto a y=792, cioè 793).
La viewport *è* tutta la tela disponibile — `.screen` deve restarci dentro
(`bottom:0`).

**Fix effettivo**: accettare la viewport da 793 e smettere di sprecare
spazio dentro di essa. `env(safe-area-inset-bottom)` riporta 34px come se
la viewport fosse a schermo intero, ma l'home indicator sta **fuori**,
nella striscia sotto: riservargli spazio dentro la navbar impilava spazio
morto su spazio morto, ed è questo che si vedeva come "menù troppo
grande".
```css
@media (display-mode: standalone){ .navbar{ padding-bottom:2px; } }
```
Navbar da 83pt → 49pt; lo spazio sotto le etichette passa da ~100pt a
~66pt (una tab bar iOS nativa ne ha ~42).

**Residuo noto**: quei ~59pt di striscia non dipinta in fondo non sono
eliminabili in `black-translucent` — è il prezzo di avere la status bar
color crema. L'unica alternativa è tornare a `status-bar-style: default`,
dove la viewport parte sotto la status bar e arriva al fondo vero (niente
striscia), ma la status bar torna a essere disegnata da iOS.

**Corollario**: `env()` funziona correttamente, sia sopra che sotto. I
tentativi di "limitare" l'inset inferiore con `min(..., 34px)` sembravano
non avere effetto solo perché **il service worker non consegnava il CSS**
(vedi sezione sotto) — due bug diversi sovrapposti, ed è quello che ha
reso la diagnosi così lunga. Si usa `env(safe-area-inset-bottom)` normale.

**Come si è chiusa**: smettendo di dedurre dagli screenshot e facendo
stampare all'app i propri numeri (`renderBuildLine()` in `main.js`, riga
in fondo a Profilo). Tre round di ragionamento sui pixel non erano
riusciti a distinguere "navbar alta il doppio" da "`.screen` che finisce
presto", perché le due ipotesi producono **lo stesso identico screenshot**;
una riga di numeri l'ha risolto al primo colpo.
### Come misurare invece di indovinare

Questa vicenda (status bar grigia, fascia nera, navbar gonfia) è costata
molti tentativi a vuoto perché si ragionava sui sintomi. Le due tecniche
che l'hanno invece chiusa in fretta, da riusare:

1. **Campionare il colore del pixel** nello screenshot del device
   (`PIL`): distingue canvas nativo (`#000000`) da un elemento dell'app
   dipinto male — è così che si è scoperto che la fascia era `#111011`,
   cioè `body` in dark mode.
2. **Confrontare le coordinate device vs locale**: misurare nello
   screenshot dove cadono testi e bordi (in pt, dividendo i pixel per il
   device pixel ratio) e confrontarle con le stesse misure prese in
   Chromium via Playwright. La differenza *è* il valore che iOS sta
   riportando, senza doverlo indovinare: è così che si è ricavato che
   `env(safe-area-inset-bottom)` valeva 93pt e non 34pt.

### Service worker: gli aggiornamenti possono non arrivare mai a una PWA standalone

`public/sw.js` si dichiara network-first, ma per mesi **non lo è stato**:
durante il debug della navbar quattro deploy consecutivi non hanno
prodotto **nessun** cambiamento sul device, con la navbar a 141.0pt
identici al pixel anche dopo aver messo un `padding` completamente
statico — cioè un valore che non può fallire il parsing. Quella è la
prova che il CSS non arrivava affatto.
**Causa principale**: il fetch handler chiamava
`fetch(event.request, { cache: 'no-store' })`. Passare un init object fa
**ricostruire** la Request, e ricostruire una richiesta con
`mode: "navigate"` lancia un `TypeError`; in più il supporto WebKit
all'opzione `cache` dentro un service worker è lacunoso. Ogni eccezione
finiva nel `.catch()` che serve `caches.match()`, quindi l'app rendeva
per sempre quello che era in cache all'ultimo install, e i deploy
sembravano non fare niente a meno di alzare `CACHE`. Ora è un
`fetch(event.request)` nudo, **senza init object** — non toccarlo.

**Causa secondaria**: senza `skipWaiting()` un service worker nuovo resta
in stato *waiting* finché tutti i client non si chiudono — e una PWA iOS
lanciata dall'icona Home non viene quasi mai chiusa davvero (tornarci
dall'app switcher è un resume, non un reload). Aggiunti
`self.skipWaiting()` in `install` e `self.clients.claim()` in `activate`.

**Indicatore di build**: la schermata Profilo mostra in fondo `build NN`
(`.app-build` in `index.html`), allineato a `CACHE` in `sw.js`. Serve a
capire da uno screenshot **quale versione sta girando davvero**, invece
di dedurlo: alzarlo insieme a `CACHE` ad ogni cambio dello shell.

**Quando si cambiano file dello shell, alzare sempre `CACHE`**
(`calice-shell-vNN`): è quello che forza il reinstall e il `cache.addAll`
dei file freschi.

Per farsi mandare un test attendibile dall'utente: il deploy da GitHub
Actions impiega ~45s, quindi va aspettato che il run sia **completato**, e
poi l'app va **chiusa davvero** (scorrendola via dall'app switcher) e
rilanciata dall'icona — un semplice ritorno all'app non ricarica nulla.

## Home: tab "Da bere / Regioni / Attività" (era tre sezioni separate)

Riprogettata su richiesta esplicita dell'utente ("troppo ricca e caotica")
dopo un giro di mockup su una canvas di design (tre direzioni: essenziale,
editoriale con tab, orientata all'azione — scelta la B). Cambi:

- Tolto `.hero`/`.ring` dalla Home: i tre numeri (bottiglie/valore/da bere)
  sono ora una riga semplice senza card (`.stat-row-plain`, non
  `.stat-row` — quest'ultima ha `flex:1` che assume un genitore flex-row
  come `.hero`; usata come figlio diretto di `.view`, che è flex-column,
  `flex:1` la farebbe crescere in altezza per riempire lo spazio
  rimanente della colonna).
- `.explore-entry` non è più una card bianca: bordi solo sopra/sotto,
  sfondo trasparente — stesso trattamento del resto della Home dopo
  questo redesign.
- "Da bere presto" (card fotografiche orizzontali, `.wine-card`),
  "Regioni principali" e "Attività amici" (due card bianche separate)
  sono diventate un unico blocco: un segmentato (riusa `.segmented`, già
  usato in Cantina) con tre pannelli, uno visibile alla volta. Il "Da
  bere" ora usa `.list-row`/`.type-dot`/`.lbody` (già esistenti,
  usate da Elementi cantina ed Esplora) invece delle card fotografiche —
  `.wine-card`/`.scroller`/`.card-photo`/`.card-body` erano usate solo
  qui e sono state rimosse come CSS morto (le card non erano comunque
  mai state cliccabili: vedi il commento storico in `index.html` sui
  listener delegati mai davvero collegati).
- Il tab selezionato si azzera su "Da bere" ad ogni `mountHome()`
  (naviga via e torna, es. Cantina → Home): senza reset, la vista
  `#view-home` resta nel DOM tra una navigazione e l'altra, quindi la
  tab lasciata aperta l'ultima volta resterebbe attiva.

### Bug trovato durante l'implementazione: l'attributo nativo `hidden` viene battuto da una regola con `display`

Primo tentativo: nascondere i pannelli non attivi con l'attributo nativo
HTML `hidden` (`<div class="home-tab-panel" hidden>`) e la proprietà
`.hidden` in JS. Risultato: **tutti e tre i pannelli restavano visibili
contemporaneamente**, sovrapposti. Causa: `.home-tab-panel{display:flex;
...}` è una regola d'autore, e le regole d'autore battono sempre lo
user-agent stylesheet (che è dove vive `[hidden]{display:none}`) —
**a prescindere dalla specificità**, perché l'origine (UA < autore) viene
prima nel calcolo della cascata. Bastava che una classe con `display`
esplicito si applicasse allo stesso elemento perché l'attributo nativo
smettesse di funzionare.

Il progetto in realtà non usa mai l'attributo nativo `hidden` altrove —
usa una classe `.hidden{display:none}` esplicita (es.
`.camera-shutter-wrap.hidden`). Adeguato a quella convenzione: i pannelli
si nascondono con `classList.toggle('hidden', ...)`, non con la proprietà
`.hidden`. **Mai usare l'attributo `hidden` nudo in questo progetto** se
l'elemento (o una sua classe) ha già un `display` impostato altrove —
usare sempre la classe `.hidden`.

**Attenzione: non esiste una regola `.hidden` globale** in `app.css`: ogni
componente ha la sua (`.home-tab-panel.hidden{display:none}`, ecc.).
Usando la classe `hidden` su un elemento nuovo va aggiunta anche la sua
regola, altrimenti non nasconde niente (build 134: foto segnaposto e
pulsante "Rimuovi" sempre visibili nel foglio Modifica).

## Dati di `wine-atlas.js`: verificati via web una volta, non riverificare da zero

I dati vini/uve per regione sono stati scritti a mano da conoscenza
enologica diretta, poi passati per una verifica web sistematica (8
agenti paralleli, uno per area geografica, ~10-15 ricerche mirate
ciascuno contro fonti ufficiali: disciplinari DOC/DOCG italiani, INAO
francese, consorzi DO spagnoli, Wine Australia GI register, TTB
statunitense, Wikipedia). 23 correzioni puntuali sono state applicate
(dettaglio in `HANDOFF.md`) — solo sostituzioni di singoli campi, mai
riscritture, verificato con un diff strutturale che path SVG/viewBox/
altri campi non fossero toccati.

Se si nota un errore specifico, **correggerlo puntualmente** (stesso
pattern: trovare l'entry per nome, cambiare il campo sbagliato) invece
di rifare l'intera verifica da capo. Alcuni casi sono stati lasciati
apposta come non-errori perché rappresentano l'identità enologica
convenzionale di un paese anche se minoritari per ettari coltivati
(es. Cabernet Sauvignon come vitigno "principale" argentino, Pinotage
per il Sudafrica, Carménère per il Cile) — non "correggerli" di nuovo
verso il vitigno più coltivato in assoluto, è una scelta editoriale
consapevole.

## Reveal simultaneo (Home/Statistiche) + crossfade di navigazione

Segnalazione utente: "la pagina si carica a pezzi e si vede" (Home).
Prima di scrivere codice, tre mockup HTML su una canvas di design
(dissolvenza semplice, fade+assestamento, tutto insieme a **cascata
scaglionata** ~55ms per sezione) — l'utente ha scelto inizialmente la
terza. Provata su device, l'ha giudicata "macchinosa": voleva che la
pagina diventasse **tutta visibile insieme** quando pronta, non a pezzi
neanche se il "pezzo" è solo un ritardo di 55ms. La cascata scaglionata
è stata quindi **rimossa** in favore di un reveal simultaneo — non
riproporla senza che sia l'utente a richiederla di nuovo esplicitamente.

**Causa reale del problema originale** (questa parte resta valida):
`mountHome()` faceva quattro `await` in sequenza (utente → cantina →
bottiglie → attività). Ogni sezione popolava il DOM non appena il
proprio dato arrivava, quindi il nome utente compariva quasi subito e il
resto arrivava sfalsato — non un problema di transizioni CSS ma di
*quando* i dati diventano disponibili. Le quattro fetch ora partono
tutte insieme in un unico `Promise.all` (la dipendenza cantina→bottiglie
resta annidata dentro un branch: non si può recuperare l'id della
cantina prima di averla scaricata) — questa parte del fix rimane com'è.

**Reveal attuale (`revealSections()` in `home.js`/`stats.js`)**: una
volta che *tutte* le sezioni hanno già il loro contenuto reale nel DOM,
tutte ricevono la classe `revealed` nello **stesso** `requestAnimationFrame`
— un solo fade+translateY (CSS `.reveal-target`/`.revealed` in
`app.css`) per l'intera pagina, non una sequenza. Prima di quello, le
classi `reveal-target`/`revealed` vengono rimosse e si forza un reflow
(`void document.body.offsetHeight`) così che il "prima" (opacity 0) sia
effettivamente dipinto — altrimenti il browser può coalescare rimozione
e riaggiunta in un solo ricalcolo di stile e il fade non parte mai.

**Ordine che conta**: `revealSections()` va chiamato *dopo* che ogni
sezione ha già il suo `innerHTML`/testo reale — non prima. Applica solo
la transizione di comparsa, non sostituisce il rendering: se lo si
chiama con lo skeleton ancora nel DOM, è lo skeleton a dissolversi in
vista, non il contenuto vero.

**Cantina (`cellar.js`) lasciata fuori deliberatamente**: la sua
schermata principale è un'unica lista, non più widget indipendenti come
Home — non ha lo stesso sintomo di "pezzi visibili in momenti diversi",
quindi non è stata toccata. Se in futuro Cantina mostra più sezioni
indipendenti visibili insieme, riusare lo stesso pattern
`reveal-target`/`revealed` (reveal simultaneo, non a cascata).

**Crossfade di navigazione** (`showView()` in `main.js`): l'utente ha
chiesto esplicitamente "molto smooth" e "un'idea di solidità" per la
navigazione tra schermate, non solo per il caricamento dati di una
singola schermata. `.view.active` parte a `opacity:0` (transizione CSS
in `app.css`), e `showView()` aggiunge la classe `.shown` un frame dopo
(`requestAnimationFrame`, stesso motivo del reflow sopra: altrimenti
niente da cui sfumare) così ogni cambio di vista è un fade-in di
~180ms invece di uno scatto istantaneo `display:none`→`flex`. Indipendente
dal reveal dei dati sopra: questo anima il **cambio di schermata**, quello
anima il passaggio da skeleton a contenuto reale dentro la stessa
schermata.

## Righe espandibili in lista: mai un pannello come fratello diretto di `.list-row`

Trovato implementando l'espansione "vino → uve che lo compongono" in
Esplora (vedi `HANDOFF.md` per il dettaglio della feature, completa).
`.list-row` ha una regola condivisa con altre schermate:
`.list-row:last-of-type{border-bottom:none}` — pensata per
un elenco piatto dove l'ultimo elemento non deve avere il bordo
inferiore.

Se si aggiunge un pannello espandibile come **fratello diretto** di
`.list-row` (es. `<div class="list-row">...</div><div class="detail-panel">...</div>`
ripetuto per ogni riga), `:last-of-type` smette di individuare "l'ultima
riga della lista": ora individua "l'ultimo `.list-row` dentro il suo
genitore immediato" — e siccome ogni `.list-row` è di nuovo l'unico
`.list-row` tra i figli del suo contenitore (l'altro figlio è un `div`
di classe diversa), la regola scatta su **ogni singola riga**, non solo
sull'ultima: tutti i separatori spariscono.

**Fix**: avvolgere riga + pannello in un contenitore dedicato (qui
`.wine-item`), spostare il bordo separatore lì (`.wine-item{border-bottom:...}`,
`.wine-item:last-of-type{border-bottom:none}`), e togliere il bordo da
`.list-row` dentro quel contesto (`.wine-item .list-row{border-bottom:none}`).
Vale ogni volta che si aggiunge un pannello/dettaglio accanto a un
`.list-row` esistente altrove nel progetto — non solo per le uve.

## `wine-atlas.js`: gli `id` di regione sono unici solo DENTRO un paese, non tra paesi

Trovato durante il merge dei dati uva-per-vino (523 vini, vedi
`HANDOFF.md` punto 9). Stati Uniti e Australia usano entrambi `wa` come
id regione (Washington / Western Australia) — id brevi e "ovvi" per chi
scrive i dati, ma **non globalmente unici** nel dataset. Uno script che
costruisce una mappa piatta `{ [regionId]: dataset }` iterando su tutti
i paesi va silenziosamente in collisione: l'ultimo paese processato
sovrascrive il precedente nella mappa, senza errori, senza avvisi — è
esattamente il tipo di bug che *non* si nota finché non si controllano i
dati risultanti a mano (è stato lo stesso agente di ricerca ad
accorgersene, notando che i nomi dei vini nel proprio batch non
corrispondevano al paese assegnato).

**Regola**: qualunque script che processa `wine-atlas.js` per regione
deve indicizzare/matchare per **coppia** `(countryId, regionId)`, mai per
`regionId` da solo — anche se sembra improbabile una collisione, non lo
è (sigle di stati/province ricorrono tra paesi: `wa`, `sa`, `ca`... da
verificare caso per caso prima di assumere unicità globale).

## `wrangler d1 migrations apply` e `wrangler dev`: `--persist-to` di default dipende da dove sta il file di config, non dalla cwd

Trovato testando in locale la migrazione del profilo di gusto
(`HANDOFF.md` punto 10). Lanciando `wrangler d1 migrations apply
--config worker/wrangler.jsonc` da una parte e poi `wrangler dev
--config wranglertest.jsonc` (config di scratch alla radice del repo,
vedi sezione più sotto) dall'altra, il secondo comando falliva con "no
such table: users" **anche se la migrazione era già stata applicata**.
Causa: senza un `--persist-to` esplicito, wrangler risolve la directory
di stato locale di D1 **relativa alla posizione del file di config**,
non alla cwd da cui lo si lancia — due config in due directory diverse
producono due SQLite fisicamente diversi anche con lo stesso
`database_id`/binding, senza nessun errore che lo segnali.

**Fix**: passare lo stesso `--persist-to <path assoluto>` esplicito a
**entrambi** i comandi (sia `migrations apply` sia `dev`), così puntano
alla stessa directory di stato indipendentemente da quale config
usano.

## Il deploy NON applica le migrazioni D1 — applicarle a mano a ogni nuova migrazione

`.github/workflows/deploy.yml` esegue solo `wrangler deploy` (codice e
asset). Le migrazioni in `worker/migrations/` vanno applicate al database
di produzione a parte. Successo davvero: la `0006_tasting_profile.sql`
(colonne del profilo di gusto delle note) è rimasta non applicata per
settimane e **ogni nota con aromi/abbinamenti/cursori falliva** in
produzione con "Vino salvato, ma il salvataggio della nota di degustazione
è fallito" — il codice inseriva colonne che non esistevano. In locale e nei
test tutto passava, perché lì le migrazioni girano sempre.

**Ora il workflow le applica da solo** (passo "Apply D1 migrations" prima
del deploy, `migrations_dir` puntato a `worker/migrations` nel
`wrangler.jsonc` di radice). Se quel passo fallisce per permessi, il token
`CLOUDFLARE_API_TOKEN` ha perso D1:Edit (errore 7403): il passo è
bloccante, quindi in quel caso il deploy non parte. Il permesso è stato
aggiunto dall'utente e verificato ("No migrations to apply!"). Per applicarle a mano (es. senza
deploy), controllare prima con
`select name from d1_migrations` (database `calice-db`, id
`01336527-aa78-4967-909e-eb423784c90d`). Si può fare con
`wrangler d1 migrations apply calice-db --remote` oppure, dalla sessione,
con lo strumento Cloudflare `d1_database_query`: in quel caso eseguire lo
SQL della migrazione **e** registrarla con
`insert into d1_migrations (name) values ('<file>.sql')`, altrimenti un
futuro `migrations apply` la rieseguirebbe (e un `ADD COLUMN` doppio fallisce).

## Endpoint PATCH che sovrascrive dati opzionali: mai `coalesce`, serve un overwrite completo

Deciso per `PATCH /api/wines/:id` (`HANDOFF.md` punto 10), ma è una
regola generale per ogni futuro endpoint PATCH in questo progetto.
`coalesce(?, colonna)` (già usato in `PATCH /api/bottles/:id`) va bene
**solo** quando il client invia aggiornamenti genuinamente parziali
(campo omesso = non toccare), perché `coalesce` non può mai distinguere
"campo omesso" da "campo esplicitamente svuotato a null" — un client
che invia sempre lo stato intero del form e prova a svuotare un campo
opzionale (es. "Regione") con `coalesce` fallisce silenziosamente a
cancellarlo nel DB.

**Regola**: se il client invia sempre lo stato completo del form (come
i fogli "Rivedi e conferma"/modifica vino), l'endpoint deve fare un
overwrite completo di tutti i campi ad ogni chiamata, accettando `null`
esplicito per i campi opzionali — pattern già usato in
`PATCH /api/bottles/:id/location`, riusato per `wines.ts`. Usare
`coalesce` solo per endpoint dove il client invia davvero un
sottoinsieme dei campi.

## `.settings-list` in Profilo: riga "Aiuto" troncata — APERTO, il fix `translateZ(0)` non ha funzionato

**Stato: il problema resta**, segnalato dall'utente dopo il deploy della
build che applicava il fix sotto. Non riprovare un altro rimedio alla
cieca — leggere fino in fondo prima di toccare di nuovo questo CSS.

Segnalazione utente originale, con screenshot: l'ultima riga di
`.settings-list` ("Aiuto") appariva troncata — solo un frammento di
bordo, non l'icona/etichetta/chevron. Il codice era corretto (nessuna
riga tocca quel DOM via JS, il markup delle 4 righe è identico
strutturalmente).

**Precondizioni, tutte verificate**: `.settings-list` ha
`border-radius` + `overflow:hidden` (crea un layer di compositing), è
annidata dentro `.view` che ha `-webkit-overflow-scrolling:touch`
(scroll momentum), e sopra di lei nel DOM c'è `#profile-follows`, il
cui contenuto passa in modo asincrono da skeleton (due righe, alto) a
reale (una riga di testo o niente, basso) **dopo** che la pagina ha già
fatto il primo paint. Misurato con Playwright navigando per hash (così
`mountProfile()` gira davvero, non basta un semplice toggle di classe):
lo scarto è di **62px**, e sposta `.settings-list` verso l'alto dopo
che WebKit l'ha già dipinta. È esattamente la combinazione nota per far
sì che Safari non ridipinga correttamente l'ultimo elemento di un box
del genere dopo che un fratello sopra si è ridimensionato.

**Non riproducibile in Chromium/Playwright** (confermato): il layout
finale è identico prima e dopo il fix, in locale non si vede alcuna
differenza — è lo stesso limite già annotato per lo status bar iOS,
Playwright headless non riproduce i bug di compositing/repaint reali di
WebKit. Per questo la diagnosi qui si è fermata a "precondizioni tutte
presenti, rimedio noto", non a una riproduzione locale del sintomo.

**Fix tentato, NON confermato**: `transform:translateZ(0)` su
`.settings-list`, che forza un layer di compositing persistente — il
rimedio storico per questa classe di bug WebKit (nessun effetto visivo
in nessun browser, è una trasformazione 3D nulla). Deployato in build
79. **L'utente ha segnalato che il problema resta**, senza un nuovo
screenshot — quindi non è dato sapere se: (a) la diagnosi era giusta ma
il rimedio non basta da solo, (b) la diagnosi era sbagliata e la vera
causa è un'altra, o (c) il device non aveva ancora caricato la build
nuova (va sempre verificato per primo: chiudere l'app dall'app switcher
e riaprirla, non basta tornarci — vedi la sezione sul service worker).

**Prossimo passo, non saltarlo**: chiedere un nuovo screenshot prima di
toccare ancora questo CSS. Se il sintomo è identico (stesso frammento di
bordo, stessa riga), vale la pena isolare con la stessa tecnica già
usata altrove in questo file — una riga diagnostica che stampi i propri
numeri invece di dedurli dai pixel (vedi "Come misurare invece di
indovinare" più sotto) — piuttosto che tentare un quarto rimedio a
occhio. Se in futuro lo stesso sintomo compare su un altro box con
`border-radius`+`overflow:hidden` dentro una vista con
`-webkit-overflow-scrolling:touch` (es. `.compare-col`, stessa forma),
questa diagnosi/rimedio resta il primo sospetto — ma qui, su
`.settings-list`, non ha chiuso il caso.

## Classi di foto condivise (`cphoto` e simili): la dimensione è scoped al genitore, non alla classe

Trovato nel picker "scegli la bottiglia" di Elementi cantina
(`renderBottlePickerForSlot()` in `cellar.js`): la foto usciva a
dimensione naturale (enorme) invece che compatta come nella lista
Cantina. La funzione condivisa `photoHtml(b, className)` genera sempre
un `<img class="cphoto photo" ...>` o un placeholder `<div class="cphoto
photo ${tipo}">`, ma le sue regole di taglia in `app.css` non sono su
`.cphoto` — sono su `.cellar-row .cphoto`. Qualunque nuovo contenitore
che chiama `photoHtml(b, 'cphoto')` fuori da `.cellar-row` (qui
`.elem-row`) eredita zero regole di dimensione, perché la specificità
sta nel selettore composto, non nella classe da sola.

**Regola**: prima di riusare `photoHtml()` (o qualunque helper che
produce una classe "generica" come `cphoto`) dentro un nuovo
contenitore, cercare in `app.css` se quella classe ha regole scoped a un
contenitore specifico — se sì, replicare esplicitamente la regola per il
nuovo contenitore (`.nuovo-contenitore .cphoto{...}`), non assumere che
la classe porti già le sue dimensioni. Non vale solo per `cphoto`: lo
stesso pattern si ripete per altre classi "di componente" in questo
progetto (`.type-dot`, `.cprice`, ecc.), tutte scoped al proprio genitore
diretto invece che definite standalone.

## Gruppi di righe correlate: non lasciarle prendere il gap del flex-column del genitore

`build NN` e la riga di attribuzione Flaticon in Profilo erano due
`<div>` fratelli diretti di `.view` (che è `flex-direction:column;
gap:20px`) — ognuna prendeva 20px di distanza dal vicino, risultando in
troppa aria tra due righe che sono concettualmente un blocco unico
(un tag di build e la sua attribuzione). **Regola**: quando due o più
righe adiacenti sono correlate e vanno lette come un solo blocco,
raggrupparle in un wrapper dedicato con un proprio gap più stretto
(qui `.app-footer{display:flex; flex-direction:column; gap:2px;}`)
invece di lasciarle come fratelli diretti di un contenitore con un gap
pensato per sezioni indipendenti. Il gap tra il blocco e l'elemento
sopra (qui `.logout`→`.app-footer`) resta quello del genitore, invariato.

## Ricerche "live" da input: servono SEMPRE una guardia di staleness e un `q` vuoto che non matcha

Due bug distinti che producevano lo stesso sintomo — cancellare la parola
cercata in "Aggiungi vino" e ritrovarsi una lista di vini a caso con la
casella vuota.

1. **`like '%%'` matcha tutto.** `GET /api/wines/search` costruiva
   `` `%${c.req.query('q') ?? ''}%` ``: con `q` vuoto diventa `'%%'`, che
   in SQL matcha **ogni riga**, quindi l'endpoint restituiva l'intero
   catalogo come se fosse un risultato di ricerca. Ora un `q` vuoto o di
   soli spazi torna `[]`. Vale per qualunque futura ricerca `like`: il
   caso "termine vuoto" va gestito **prima** di costruire il pattern, mai
   lasciato cadere dentro la query.
2. **Risposte in ritardo che ridisegnano la lista.** `runSearch()` in
   `add.js` parte a ogni tasto e fa `await`, ma non controllava che la
   query fosse ancora quella corrente quando la risposta arrivava.
   Cancellando una parola parte una richiesta per ogni tasto: il ramo
   "casella vuota" pulisce la lista subito, poi la risposta di una query
   intermedia ancora in volo atterra e **la ridisegna**. Lo stesso vale
   digitando in avanti, con la risposta di una query più corta che
   sovrascrive quella di una più lunga.

   `searchWeb()`, venti righe più sopra nello stesso file, quella
   guardia ce l'aveva già (`if (currentQuery() !== query) return;`) — a
   `runSearch()` era stata dimenticata. **Regola: ogni funzione che fa
   `await` fra un input dell'utente e una scrittura nel DOM deve
   ricontrollare, dopo l'await, che l'input non sia cambiato.**

3. **Accenti.** `LIKE` di SQLite non li ignora: si cerca su
   `wines.search_text` (testo già piegato da `foldSearch()` in `wines.ts`).
   Qualunque nuova scrittura su `wines` deve rimettere `search_text = null`
   (la ricerca la ricalcola); una nuova ricerca testuale su altre tabelle
   deve piegare allo stesso modo, non affidarsi a `LIKE` da solo.

**Come riprodurlo** (serve, perché a mano è questione di millisecondi):
Playwright con `page.route('**/api/**')` che stubba la ricerca con un
ritardo artificiale (~900 ms), servendo `public/` con
`python3 -m http.server` — niente wrangler né D1. Poi digitare, e
cancellare **mentre la richiesta è ancora in volo** (aspettare la
risposta prima di cancellare non riproduce nulla: è l'errore in cui sono
cascato al primo tentativo). Senza guardia la lista torna popolata,
con guardia resta vuota.

## Costo zero: niente servizi a pagamento, tetti sui servizi gratuiti

Richiesta esplicita dell'utente: l'app non deve **mai** far pagare nulla.
- **Tavily è stato tolto** (era la ricerca web a crediti, usata come riserva
  e per il codice a barre). Non reintrodurlo, né un'altra API a consumo, senza
  che sia l'utente a chiederlo. La ricerca per nome usa solo l'indice di
  Vivino (`worker/src/lib/vivino-search.ts`, non ufficiale e gratuito: se
  fallisce resta il nome digitato); il codice a barre usa catalogo locale e
  Open Food Facts; Wikidata per le uve. `GET /api/wines/recognize/debug?q=…`
  mostra cosa riceve il Worker da Vivino in produzione.
- **Workers AI** (lettura etichetta) ha un tetto in codice:
  `OCR_DAILY_LIMIT` foto al giorno (tabella `ai_usage`, `recognize.ts`), ben
  dentro l'allocazione gratuita; oltre, il foglio si apre da compilare a mano
  con un avviso. Qualunque nuova chiamata a un servizio a consumo va
  protetta allo stesso modo.
- **Ricerca per nome**: le risposte di Vivino sono tenute 30 giorni in
  `search_cache` (comune a tutti gli utenti, `recognize.ts`). Una nuova
  fonte esterna per la ricerca va messa dentro la stessa memoria, non
  chiamata a ogni tasto.
- Il resto (Workers, D1, R2, Access, GitHub Actions) è nei piani gratuiti;
  l'utente controlla da sé il piano Cloudflare (Billing).

## Icone della schermata Home iOS: opache, quadrate, arte al ~74%

L'icona attuale (grappolo + calice a tratto) è **di Flaticon**, licenza
free che **obbliga all'attribuzione**: il credito *"Wine icons created
by iconixar - Flaticon"* è in Profilo (`.app-credit`) e non va rimosso
finché l'icona resta quella. Se un domani si cambia disegno, togliere
anche il credito.

Regole imparate generando gli asset (`apple-touch-icon.png` 180,
`icon-192.png`, `icon-512.png`, tutti rigenerati con Pillow dal PNG
originale):

- **Mai lasciare l'alpha**: iOS dipinge di **nero** ogni zona
  trasparente di un'icona di Home. I file vanno salvati in `RGB` su
  fondo pieno, mai `RGBA`.
- **Mai arrotondare gli angoli** nel file: iOS applica da sé la maschera
  squircle. Un PNG già arrotondato finisce arrotondato due volte.
- **Arte al ~74% della cornice**: il PNG originale la teneva al 91%, che
  per un'icona è troppo — la maschera squircle taglia gli angoli e il
  disegno tocca i bordi.
- **Il tratto sottile non si salva ingrassandolo**: provato a dilatare
  l'alpha per reggere a 29×29 px (Impostazioni), risultato peggiore
  perché gli acini del grappolo si chiudono. Un disegno con molti
  dettagli a quella misura impasta e basta: o si accetta, o serve un
  disegno più semplice, non un tratto più grosso.
- Quando si toccano questi file, valgono le regole dello shell: alzare
  `CACHE` in `sw.js`, il marcatore `build NN` in `index.html`, e
  aggiungere i file nuovi a `SHELL_FILES`.

## Selettori DOM globali (`document.querySelectorAll`) su componenti che possono comparire più volte nella pagina

Trovato mentre si aggiungeva un secondo gruppo di stelle
(`#rec-note-stars`) accanto a quello già esistente nella scheda
dettaglio (`HANDOFF.md` punto 10). In questo progetto i fogli/overlay
convivono **sempre** tutti nel DOM (solo uno è visibile per volta, gli
altri sono lì ma nascosti) — quindi qualunque markup ripetuto tra due
fogli (stelle, chip, slider...) esiste in **due o più copie
contemporaneamente** anche quando sembra essercene solo una visibile
sullo schermo in quel momento.

Il wiring esistente di `detail.js` selezionava `.stars-input span`
**globalmente su tutto il documento**: funzionava finché esisteva un
solo gruppo di stelle nella pagina, ma è diventato un bug di
cross-wiring reale (click su un gruppo che accende le stelle
dell'altro) nel momento in cui è comparso un secondo gruppo altrove nel
DOM, anche se logicamente "in un altro foglio".

**Regola**: qualunque nuovo componente interattivo ripetibile
(stelle, chip, slider, contenitori generici) va sempre wired iterando
prima il contenitore che lo identifica univocamente (es. ogni
`.stars-input`) e scopando la query dei figli a quel contenitore
(`container.querySelectorAll(...)`), mai con un selettore
`document.querySelectorAll` diretto sui figli — anche se al momento in
cui si scrive il codice sembra esserci una sola istanza nella pagina.
Il modulo condiviso `public/js/tasting-profile.js` segue già questo
pattern (tutte le funzioni prendono un `root` e scopano le query a
quello) proprio per evitarlo in partenza.

## Minimi HIG (accessibilità): non scendere sotto, ogni nuova UI li rispetta

Fissati dall'audit secondo le Human Interface Guidelines di Apple (`HANDOFF.md`
punto 19). Valgono per qualunque markup o CSS nuovo, non solo per quello
già corretto:

- **Testo mai sotto 11px**; secondario 12px. Colore del testo secondario
  `#736a5d` (≥4,5:1 su crema, bianco e grigio dei selettori). **Non**
  reintrodurre `#8f8474`/`#a89b89`/`#c2b8a8` come colore di testo: restano
  ammessi solo per icone, bordi e decorazioni.
- **Ogni controllo ≥44pt di area di tocco.** Se il controllo visibile è più
  piccolo, estendere l'area con un `::after` trasparente (pattern nel blocco
  `/* HIG: leggibilità e tocco */` di `app.css`) — ma un antenato con
  `overflow:hidden/auto` lo ritaglia: controllare con `elementFromPoint`.
- **Ogni controllo non nativo** (`div` con listener di click) prende
  `role="button" tabindex="0"`, e `aria-label` se non ha testo visibile.
  Invio/Spazio funzionano già grazie all'handler delegato in `main.js`.
- **Stato di pressione**: aggiungere la classe del nuovo controllo alle
  liste `:active` di `app.css`. Il `touchstart` vuoto in `main.js` serve a
  iOS per applicare `:active` ai `div`: non toglierlo.
- **Nuovi fogli dal basso**: registrarli in `js/sheet-gestures.js` (mappa
  overlay → pulsante di chiusura), così hanno maniglia, tocco sullo sfondo
  e trascinamento.
- **Azioni distruttive**: conferma (`confirmModal`, `danger:true`) se
  irreversibili, altrimenti `showToast(..., { actionLabel: 'Annulla' })`
  da `js/toast.js`.
- La scheda attiva del menu in basso la decide **solo** `showView()` in
  `main.js`: una nuova vista senza scheda propria va aggiunta a
  `TAB_FOR_VIEW`; una nuova scheda va aggiunta a `HASH_FOR_VIEW` (le
  rotte non sono tutte `#/<nome-vista>`: Esplora è `#/esplora`). Il menu
  (build 172, scelta dell'utente) è Home · Vini (`view-cellar`, `#/cellar`)
  · + · Cantina (`view-places`, `#/cantina`: gli elementi) · Profilo;
  Statistiche è una pagina di Profilo (`#/stats`, scheda Profilo accesa,
  freccia indietro). Quattro sezioni più, al centro, il "+" in rilievo (scelto
  dall'utente su mockup, al posto della scheda Esplora che resta una
  sotto-sezione della Home): nessun'altra azione nel menu. Il "+" **non è
  una scheda**: apre il foglio "Aggiungi un vino" sopra la schermata
  corrente (`openAddSheet()`), non c'è più una vista Aggiungi. Qualunque cosa
  si appoggi sopra il menu (toast, pannelli) va posizionata sopra il punto
  **più alto** del menu, cioè il cerchio che sporge di 21px (vedi
  `toast.js`), non sopra `.navbar.offsetHeight`.
- **Testo in `calc(Nrem/17)`, mai in `px`** (Dynamic Type: la base segue
  l'impostazione Dimensioni testo dell'iPhone, limitata fra 17 e 34px
  dallo script inline in `<head>` di `index.html`). Non usare rem
  arrotondati (`0.7059rem`): in Chromium cambiano il rendering dei
  glifi, `calc` no. Eccezioni volute in `px`: menu in basso, iniziali
  degli avatar, etichette degli slot, badge, stelle. Campi dei form
  `max(16px, …)`. Contenitori con testo: `min-height`, mai `height`
  fissa, e provare sempre a 200% (`document.documentElement.style.fontSize
  = '34px'` in Playwright).
- **Azioni sulle righe di una lista**: dietro lo scorrimento a sinistra
  (pattern `.cellar-item` + `.swipe-actions` + `wireSwipe()` in
  `cellar.js`), mai icone sempre visibili; e sempre un secondo accesso
  non gestuale (le stesse azioni nella scheda di dettaglio, e azioni
  raggiungibili da tastiera che aprono la riga al focus).
- **Pulsanti principali** (salva, conferma, aggiungi): sempre `.primary-btn`
  (bordeaux pieno, pillola, testo 14, alto ≥46), mai uno stile proprio né la
  vecchia `.action` bianca (era finita su "Salva modifiche"). Secondari:
  bianchi con bordo. Eccezioni volute: "Salva nota" compatto accanto alle
  stelle, "Stappa una bottiglia" dentro la sua scheda.
- **Campi di testo e menu**: un solo stile (blocco "Campi" in fondo ad
  `app.css`). Un nuovo campo usa `input.search`, `select.search`,
  `.text-input`, `.num-input` o è una `textarea`, e non ridefinisce bordo,
  raggio, font o focus: il focus è il bordo bordeaux con alone, non
  l'outline squadrato del browser.
- **Agenti in worktree**: il worktree può nascere da `master` invece che
  dalla punta del branch di lavoro. Ogni prompt deve cominciare con
  `git reset --hard <commit>` esplicito e chiedere di verificarlo con
  `git log --oneline -1` prima di qualsiasi modifica.

## Letture in memoria (`api-client.js`): una nuova GET che deve essere sempre fresca va esclusa

Dalla build 127 `api.get` tiene le risposte in memoria (riuso entro 30 s,
poi risposta vecchia subito + riscaricamento dietro) e il caricamento
iniziale (`js/warmup.js`) le riempie tutte: è quello che rende l'app fluida.
Ogni `post`/`patch`/`del` svuota la memoria, quindi dopo una modifica fatta
dall'app si legge sempre il dato nuovo. Regole:
- una nuova lettura che dipende da cosa si sta digitando o che deve essere
  sempre in tempo reale va aggiunta a `NO_CACHE`;
- una nuova schermata o scheda che legge dati va aggiunta anche a
  `warmUp()`, altrimenti alla prima apertura aspetta la rete;
- non modificare dati sul server con una GET: la memoria non lo saprebbe.

## Campi condivisi (`js/fields.js`): la stessa informazione si chiede, si legge e si valida sempre allo stesso modo

Audit di build 148: lo stesso dato era gestito in tre modi diversi a seconda
della schermata (bottiglie: contatore − n + nel pannello, campo di testo nel
foglio completo, finestra con campo numerico dopo il codice a barre; annata:
`type=number` e validata solo dal server nel foglio, con controllo e
segnaposto diversi nel pannello). Ora c'è un solo modulo e **ogni nuovo punto
dove compare una di queste informazioni deve usarlo**:
- **Bottiglie**: `quantityStepperHtml()` + `wireQuantitySteppers()` (− campo +,
  il numero si può anche scrivere, 1-9999; in Modifica può scendere a 0).
  Per una domanda a sé: `quantityModal()` in `modal.js`, mai `promptModal` con
  un numero.
- **Prezzo**: `parsePrice()` / `PRICE_ERROR`, campo `.affix-field` con "€" a
  destra e segnaposto "es. 18,50", mostrato sempre con `priceText()` (due
  decimali) o `eurosText()` per i totali ("197 €", mai "€197").
- **Annata**: `parseVintage()` / `VINTAGE_ERROR`, campo di testo numerico
  (`WHOLE_NUMBER_ATTRS`), segnaposto "es. 2019". Mai `type="number"`.
- **Sboccatura** (bollicine): `input type=month`, `parseDisgorged()`, presente
  nel pannello di aggiunta, nel foglio completo (aggiunta e Modifica) e
  visibile nella scheda; il pannello la passa al foglio completo se si preme
  "Modifica tutti i dati" (come quantità, prezzo e annata).
Gli interi di altri campi (livelli/colonne/profondità degli elementi, anni di
"Da bere") usano gli stessi attributi: testo con tastierino numerico.

## Un file dell'utente (backup da ripristinare) è input non fidato

Audit del 19 ottobre: il ripristino da Profilo inseriva le righe del file
così com'erano, e una chiave R2 scelta ad arte (`backups/<data>.json`) dava
accesso al backup dell'intero database. Regole: una chiave R2 o un link che
arriva da un file vale solo se ha la forma che l'app stessa scrive
(`isBottlePhotoKey`, `wines/…`, http(s)); mai toccare righe condivise (vini
del catalogo, utenti) che appartengono anche ad altri; ogni route che serve o
cancella file R2 controlla il prefisso (`bottles/`, `wines/`, `landscapes/`).
Una nuova tabella nel backup segue le stesse regole.

## Backup: copia settimanale in R2, ripristino a mano

`runWeeklyBackup()` (`worker/src/lib/backup.ts`, dal cron giornaliero) salva
tutto D1 in `calice-photos/backups/AAAA-MM-GG.json` una volta a settimana e
tiene le ultime 8. Anche le foto (richiesta dell'utente: i backup devono
avere le foto; gli export CSV no): ogni foto citata da `photos.r2_key` e
`wines.image_url` è copiata una volta in `backup-photos/<chiave>` e il backup
le elenca in `photos`; una copia si cancella quando nessuno degli 8 backup la
elenca più. Niente byte dentro il JSON: il Worker ha 128 MB di memoria. Un
nuovo posto dove si salva una foto va aggiunto a `photoKeys()` e a
`buildUserBackup()`.

**Foto: mai link esterni.** Scelta dell'utente: ogni immagine sta nel nostro
R2. Un `image_url` dal web viene copiato da `copyImageToR2()`
(`routes/wine-image.ts`) al salvataggio, e il cron riprova quelli rimasti.
Un nuovo modo di dare una foto a un vino deve passare da lì, non salvare il
link. Una **nuova tabella** finisce nella copia da sola (legge
`sqlite_master`); una tabella che non va copiata va aggiunta a `SKIP`.
Ripristino (svuota e riempie ogni tabella della copia: si perde quanto
scritto dopo quella data, quindi scaricare prima anche la copia attuale):
```
npx wrangler r2 object get calice-photos/backups/<data>.json --remote --file backup.json
node worker/scripts/backup-to-sql.ts backup.json > restore.sql
npx wrangler d1 execute calice-db --remote --file restore.sql
node worker/scripts/backup-files.ts backup.json foto > put-foto.sh   # poi: sh put-foto.sh
```
Il database deve avere le stesse migrazioni della copia (`backup.migrations`).
D1 ha anche il suo ripristino a un istante preciso (Time Travel,
`wrangler d1 time-travel restore`), utile per errori di pochi giorni fa.

**Backup scaricabile da Profilo** (`worker/src/routes/backup.ts`): una
**nuova tabella legata a una cantina o all'utente va aggiunta** a
`buildUserBackup()` e a `restoreUserBackup()` (cancellazione per le cantine
sostituite + inserimento con id rimappati), altrimenti il file non la
contiene e il ripristino la lascia com'è. Una nuova colonna invece passa da
sola (si copiano le righe intere). D1 rifiuta `select` con troppi `union`
("too many terms in compound SELECT"): unire liste di id in JS.
Un'azione che il browser concede solo dentro un tocco (foglio di
condivisione) va avviata da `confirmModal(..., { onConfirm })`, non dopo
l'`await` della conferma.

## Una sola cantina per utente

Scelta dell'utente: niente cantine multiple, i posti diversi sono gli
Elementi cantina. `ensureCellar()` (`worker/src/lib/cellars.ts`) garantisce
che ogni utente ne abbia sempre esattamente una, quindi il codice può usare
`cellars[0]`. Non reintrodurre la creazione di cantine né un selettore. App
solo personale: niente inviti, persone seguite, notifiche push o note "della
community" (tolti in build 153-154).

## Vini per utente, ricerca comune (scelta dell'utente, 19 ottobre)

Ogni vino ha un proprietario (`wines.owner_id`, migrazione 0020): modifica,
foto e annata toccano solo i vini di chi chiama (`ownsWine`). Comuni restano
solo la ricerca di "Aggiungi" (`GET /api/wines/search`: i vini di tutti, uno
per nome+produttore+annata, con i dati del record più completo, e l'id del
chiamante se ce l'ha) e `search_cache` (Vivino). Ogni route che riceve un
`wineId` da salvare (bottiglia, desiderio, annata) passa da `ownWineId()`
(`lib/wine-owner.ts`): usa il vino del chiamante o ne crea una copia, e ne
completa i campi vuoti dal record più completo. Una nuova route così deve
fare lo stesso, mai salvare l'id ricevuto così com'è.

## Sfondi dei vini: zone scelte a mano, foto in R2

Lo sfondo della scheda vino viene prima da `lib/landscape-zones.ts` (foto
guardate una per una e confermate dall'utente), poi dalla ricerca su Commons.
Per una zona nuova o una foto in più: scegliere guardando le foto (la ricerca
da sola aveva messo un vigneto californiano sul Veneto), caricarle in R2 sotto
`landscapes/<zona>/` con una chiave nuova (mai riusarne una: le immagini sono
in cache per sempre) e aggiungerle al file. Il credito (autore, licenza,
pagina Commons) è obbligatorio per CC BY/BY-SA e si vede sotto la foto.

## Assaggio guidato: finisce sempre su un vino

Scelta dell'utente: un assaggio non si salva da solo. L'ultimo passo apre il
foglio del "+" con `openAddSheet({ query, tasting: { note, mode, done } })`
e la nota va sul vino scelto (bottiglia nuova, vino già in cantina, foglio
completo o desiderio). Ogni nuovo modo di aggiungere un vino dentro
`add.js` deve rispettare `tasting` (salvare `tasting.note` e chiamare
`done`), altrimenti l'assaggio si perde in silenzio. Le note nei desideri
stanno in `wishlist_items.note` (stessa forma del corpo di
`POST /api/bottles/:id/notes`) e passano alla bottiglia con "Comprato:
sposta in cantina".

## Nota di degustazione: un solo modulo, asse non segnato = null

`tasting-profile.js` è il modulo della nota per **ogni** posto dove se ne
scrive una (foglio `#note-overlay` della scheda vino, "Rivedi e conferma"
in `add.js`): sotto-tab Aromi · Gusto · Cibo · Testo, e possiede anche il
campo di testo (`.tp-text`, letto da `readTastingProfile().text`). Un ospite
nuovo monta il modulo e tiene solo le sue stelle; non aggiunge un secondo
campo di testo. Un asse del gusto mai toccato vale `null` ("non segnato") in
lettura, in salvataggio e nella card: non usare 50 come "vuoto", altrimenti
un 5 scelto davvero e un cursore mai toccato tornano indistinguibili (era
così fino al build 160). I chip dei risultati di ricerca sono copie senza
`data-toggle`: `readTastingProfile` conta solo gli originali.

**Testo della nota = frase automatica finché l'utente non la scrive** (scelta
dell'utente, build 178): `text` vuoto significa "componi la frase"
(`composeNoteText()`), mai salvare la frase composta come `text`, altrimenti
smette di seguire aromi/gusto/cibo. Svuotare il testo la rende di nuovo
automatica. Nella scheda vino voto e testo si cambiano solo dalla card; il
foglio nota mostra una sola sezione (Aromi, Gusto o Cibo) e salva gli altri
campi così come sono.
