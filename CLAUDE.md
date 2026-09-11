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
- Mai togliere la regola `@media (display-mode: standalone)` che allunga
  `.screen` di `env(safe-area-inset-top)` oltre il fondo: senza quella,
  in PWA la navbar resta 59pt sopra il fondo dello schermo.
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

**Fix**: allungare `.screen` oltre il bordo inferiore della viewport
esattamente di quell'ammontare, solo in standalone (in Safari normale la
viewport è corretta e questo la spingerebbe fuori schermo):
```css
@media (display-mode: standalone){
  .screen{ bottom:calc(-1 * env(safe-area-inset-top, 0px)); }
}
```
Sul device: 793 + 59 = 852, cioè lo schermo esatto. La navbar torna sul
fondo vero, e il suo `padding-bottom` di `calc(2px + env(safe-area-inset-bottom))`
= 36px tiene libera l'area dell'home indicator.

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
