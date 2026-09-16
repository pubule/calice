# Note per sessioni future

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

**Come riprodurlo** (serve, perché a mano è questione di millisecondi):
Playwright con `page.route('**/api/**')` che stubba la ricerca con un
ritardo artificiale (~900 ms), servendo `public/` con
`python3 -m http.server` — niente wrangler né D1. Poi digitare, e
cancellare **mentre la richiesta è ancora in volo** (aspettare la
risposta prima di cancellare non riproduce nulla: è l'errore in cui sono
cascato al primo tentativo). Senza guardia la lista torna popolata,
con guardia resta vuota.

## Ricerca web dei vini (Tavily): tre filtri diversi, non confonderli

`worker/src/lib/tavily-search.ts` restringe la ricerca a `vivino.com`, ma
essere su Vivino non basta: ci sono **tre** problemi distinti, con tre
rimedi distinti, e confonderli porta a "sistemare" quello sbagliato.

0. **Non è nemmeno una bottiglia.** Vivino posiziona bene anche le schede
   cantina e le pagine di ricerca ("Ambrosini Winery | Vivino", "Zamuner
   Winery - Vivino" sono arrivate entrambe nel selettore in produzione).
   Toccarle avrebbe salvato un vino chiamato "Ambrosini Winery", perché
   il foglio di aggiunta precompila il nome dal **titolo**. `isWinePage()`
   tiene solo le pagine con un id `/w/<id>`: se un domani sparisce un
   vino legittimo, è il primo posto dove guardare, ma le pagine senza id
   non erano comunque aggiungibili.

1. **Stesso vino, più lingue.** Vivino serve la stessa scheda in più
   lingue sullo stesso host, e `include_domains` di Tavily filtra per
   host, non per path.

   **Gli URL hanno due forme, verificate su link reali** — e questo ha
   già prodotto un bug: `/en/zamuner-brut/w/8800805` (solo lingua) ma
   anche `/IT/it/ambrosini-franciacorta-batude/w/2667819` e
   `/BR/pt-BR/…` (paese + lingua, con eventuale suffisso di regione).
   `isItalianVivinoUrl()` faceva `pathname.startsWith('/it/')` e quindi
   **non riconosceva `/IT/it/`**, cioè proprio il caso che conta di più:
   la preferenza per l'italiano in produzione non è mai scattata. Ora la
   lingua si estrae per segmenti (se il primo è un codice paese di due
   lettere maiuscole, la lingua è il secondo). Mai assumere una sola
   forma di URL Vivino. `ITALIAN_PATH_BOOST` (0.05)
   **riordina soltanto**: per mesi ha lasciato le copie spagnole e
   inglesi in lista, che è ciò che l'utente vedeva come "record di
   Vivino Spagna". A rimuoverle è `dedupeKey()`, che raggruppa per l'id
   in `/w/<id>` — stabile fra le lingue — e tiene una sola copia.
   L'`?year=` fa parte della chiave perché Vivino appende le annate allo
   stesso id e due annate sono due bottiglie diverse.

   **Posizione e lingua sono due decisioni separate, non confonderle.**
   La deduplica gira dopo l'ordinamento, quindi un vino occupa la
   posizione guadagnata dalla sua copia con la score migliore — ma
   *quale* copia resta è deciso **solo dalla lingua**, mai dalla score.

   **`ITALIAN_PATH_BOOST` non esiste più, non reintrodurlo.** Era un
   +0.05 sulle pagine `/it/`, ed è stato sbagliato due volte: si
   limitava a riordinare i duplicati (che quindi restavano in lista), e
   quando la deduplica ha cominciato a eliminarli un margine di 0.05 non
   bastava — con 0.78 (ES) contro 0.72 (IT) sopravviveva la spagnola e
   diventava l'**unica** riga mostrata, cioè peggio di prima. Risolta la
   lingua dentro la deduplica e scartate le pagine senza id, al boost non
   restava che fare l'unica cosa che il suo stesso commento diceva di
   voler evitare: riordinare vini **diversi**. Osservato in una lista
   reale, una pagina italiana da 0.84 sopra una da 0.88. Quindi: la
   score ordina i vini, la deduplica sceglie la lingua, e non si somma
   niente alla score.
2. **Vino diverso che sembra pertinente.** `isRelevant()` chiede che
   **una sola** parola della query — la più lunga — compaia nel titolo o
   nell'URL. Un vino spagnolo con lo stesso vitigno passa (caso reale
   documentato nel file: "Don de Dar … Sauvignon Blanc" su "Zamuner
   blanc"). Se un domani serve stringere, la strada è chiedere che
   matchino **almeno due** parole distintive — ma è l'unica modifica di
   questa zona che può ridurre il recall, quindi va misurata, non
   applicata a occhio.

   **Il rovescio della stessa euristica**: la parola più lunga non è
   sempre quella giusta. Su `"batude di tenuta Ambrosini"` la distintiva
   è `ambrosini` (9 lettere), non `batude` — quindi se Vivino intitola e
   slugga la scheda col solo nome del vino (`Batude 2019`,
   `/it/batude/w/...`) il vino **giusto** viene scartato e l'utente
   legge "nessun risultato" per una bottiglia che Tavily aveva
   restituito. C'è un test che fissa questo comportamento. Rimedio
   pratico intanto: cercare il solo nome del vino, senza il produttore.
   **Gli accenti vanno ripiegati su entrambi i lati** (`fold()`): i nomi
   italiani ne sono pieni — Batudè, Satèn, Rosé — ma lo slug che Vivino
   costruisce dallo stesso nome li toglie
   (`…/ambrosini-franciacorta-batude` per un vino intitolato "Batudè").
   Senza folding chi scrive "Batude" aggancia lo slug ma non il titolo e
   chi scrive "Batudè" il contrario: in entrambi i casi si perde metà
   del segnale, e un risultato in cui il nome compare **solo** nel
   titolo viene scartato.
3. **Rumore nel titolo.** Vivino chiude i titoli con un suffisso che
   cambia per lingua — "| Vivino English", "| Vivino Italiano",
   "- Vivino", tutti e tre visti in una stessa lista. `cleanTitle()` lo
   toglie: non è solo cosmesi, il titolo è ciò da cui il foglio di
   aggiunta precompila il nome del vino, quindi finirebbe salvato in
   cantina.

**Mai rimettere un suffisso alla query** (c'era un `` `${query} vino` ``):
con la ricerca già ristretta a Vivino ogni pagina è di vini, quindi non
aggiunge nulla, e "vino" è spagnolo quanto italiano — semmai aiutava le
copie spagnole a posizionarsi. Il recall misurato (15/15 bottiglie
Zamuner reali) era comunque quello **senza** suffisso.

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
