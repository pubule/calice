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
quindi cadono sempre nel ramo che lascia `.screen` sul fallback CSS
(`top:0`, altezza — vedi sezione sotto: **non** `100dvh`, quello era un
altro bug).

### Bug distinto: fascia nera in fondo — `.screen` non deve usare `100dvh` come fallback

Il fallback CSS di `.screen` quando `--app-height` non è impostato (cioè
quasi sempre, dato il fix sopra) era `height:var(--app-height, 100dvh)`.
Sembra innocuo ma **non lo è**: il 2 settembre (commit `9d64542`, su
device reale) `100dvh` da solo era già stato scartato per lo stesso
identico sintomo (fascia nera in fondo in modalità standalone) — `dvh`
ha problemi noti su iOS standalone/fullscreen PWA, a volte risolve a
un'altezza minore di quella reale dello schermo. Il fix di allora era
`height:100%` con fallback esplicito `-webkit-fill-available` (stesso
pattern già usato per `html`/`body` in questo stesso file). Un commit
successivo (`7d0c953`, quello che ha introdotto tutto il meccanismo
`--app-top`/`--app-height`) ha **silenziosamente reintrodotto** `100dvh`
come fallback, perdendo il fix di `9d64542` — mascherato per un po'
perché l'override JS applicava `--app-height` quasi sempre, finché il
fix di focus-gating sopra non ha reso il fallback il caso comune,
riportando a galla il bug originale (osservato dall'utente come
"regressione in basso" subito dopo la riprova di `black-translucent`,
che in realtà non c'entrava — erano due bug distinti sovrapposti).

**Primo tentativo di fix (insufficiente, vedi correzione sotto)**: fallback
di `.screen` riportato al pattern `9d64542`, ma tenuto dentro `var()`:
```css
height:var(--app-height, 100%); height:var(--app-height, -webkit-fill-available);
```
Su device reale l'utente ha riportato il problema **peggiorato**, non
risolto — fascia nera in fondo più grande di prima, non più piccola.

### Correzione: `var()` con fallback a un valore vendor-prefixed non è affidabile su WebKit

Motivo del peggioramento: `height:var(--app-height, -webkit-fill-available)`
mescola due cose fragili insieme. Il pattern "progressive enhancement"
`height:100%; height:-webkit-fill-available;` (usato con successo per
`html`/`body` in questo stesso file) funziona perché il *parser* scarta
a tempo di parsing la riga con un valore che non riconosce, lasciando
intatta la riga precedente — dei due browser, uno slot vince e basta.
Ma appena il valore passa dentro `var(--x, fallback)`, la riga con
`var()` è **sempre sintatticamente valida** (il parser non sa ancora
cosa risolverà `--x`), quindi vince sempre in cascata sull'altra riga;
`-webkit-fill-available` viene *poi* risolto a tempo di valore
calcolato, e WebKit ha una storia nota di bug proprio nella
risoluzione dei fallback di `var()` (Safari Technology Preview 248,
luglio 2026, ha dovuto correggere quando un fallback viene valutato).
Se la risoluzione fallisce, la proprietà diventa "guaranteed-invalid"
e `.screen` torna al suo valore iniziale `height:auto` — cioè si
restringe al contenuto flex invece di riempire lo schermo, lasciando
un'area vuota (nera, canvas non dipinto) molto più grande della
piccola discrepanza di `100dvh` da cui si era partiti.

**Fix corretto**: `.screen` non usa più **nessuna** custom property CSS
per la sua geometria. Il fallback a riposo è il pattern
"progressive enhancement" puro, senza `var()`, identico a `html`/`body`:
```css
.screen{ position:fixed; top:0; ...; height:100%; height:-webkit-fill-available; ... }
```
L'override per tastiera aperta (in `main.js`, `applyViewportHeight`) non
scrive più `--app-top`/`--app-height` su `document.documentElement` —
scrive direttamente `style.top`/`style.height` **sull'elemento `.screen`
stesso** (inline style), e li rimuove con `removeProperty` quando la
tastiera si chiude o non c'è focus reale. Un inline style non passa da
nessuna risoluzione di fallback: o è impostato con un valore concreto in
px, o è assente e la regola CSS sopra (comprovata) si applica di nuovo.

**Regola generale per questo progetto**: mai usare `var(--x, fallback)`
quando `fallback` è un valore vendor-prefixed o comunque non-standard
(`-webkit-fill-available`, `-webkit-*` in genere). O il fallback è un
valore "normale" (es. `0px`), o il default va espresso come riga CSS
piana (parse-time), mai dentro `var()`.
