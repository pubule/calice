# Handoff

Stato del progetto per chi (o quale sessione Claude Code) riprende da qui.
Aggiornato ad ogni push — vedi `CLAUDE.md` per i dettagli tecnici/gotcha,
questo file è il riassunto "dove eravamo rimasti".

## Stato attuale

- Live su https://calice.smartcores.org, deployato dal branch `master`.
- Deploy **manuale**, non automatico al push: GitHub Actions → workflow
  `Deploy` (`.github/workflows/deploy.yml`), trigger `workflow_dispatch`
  (Actions tab → Run workflow). Serve il secret `CLOUDFLARE_API_TOKEN`
  nel repo (Settings → Secrets and variables → Actions), token con
  permessi dal template "Edit Cloudflare Workers".
- Rami: si lavora su `claude/app-style-layout-analysis-h09ehi` e si
  fast-forward-merga su `master` (nessuna PR in questo flusso finora).

## Lavoro recente (sessione corrente)

1. **Feature "Esplora vini per paese"** — nuova voce in Home → mappa +
   dropdown + card dettaglio (vini/uve/categorie), route `#/esplora`.
   Nessuna modifica backend (contenuto editoriale, non dati utente).
   Dato in `public/js/data/wine-atlas.js`, schermata in
   `public/js/screens/explore.js`. Copertura attuale:
   - **Italia**: 20/20 regioni con dati reali (mappa completa).
   - **Francia, Spagna, Germania, Stati Uniti, Australia**: mappa reale
     (confini da `@svg-maps`, CC BY 4.0) con dati curati per un
     sottoinsieme di regioni/stati (quelli enologicamente rilevanti);
     il resto mostra "dati in arrivo".
   - **Portogallo, Argentina, Cile, Sudafrica**: dati reali a livello
     nazionale ma **senza mappa** — nessun pacchetto npm con confini
     regionali per questi paesi è stato trovato (controllato
     `@svg-maps`, `@svg-country-maps`, `world-geojson`: solo Portogallo
     ha `areas/portugal` ma limitato a mainland/Azzorre/Madeira, non ai
     distretti enologici). Lo switch paese mostra comunque la card
     dettaglio, solo senza mappa/dropdown regione. Sudafrica è l'unico
     paese africano coperto — è di fatto l'unico produttore vinicolo
     africano con denominazioni ben documentate (Stellenbosch, Paarl,
     Swartland...); Marocco/Tunisia/Algeria non hanno dati verificabili
     altrettanto solidi, non aggiunti per lo stesso motivo delle
     regioni "dati in arrivo".
2. **Deploy da remoto senza credenziali locali** — workflow GitHub
   Actions manuale, per deployare da telefono/browser senza terminale.
3. **Bug PWA iOS (status bar / viewport)** — chiuso il ping-pong fra
   "grigio in alto" e "nero in basso", si è scoperto che erano tre cose
   diverse. Vedi `CLAUDE.md` per la storia e le regole da non violare.
   - L'override di altezza in `main.js` scatta **solo** se c'è un
     `input`/`textarea` con focus reale (tastiera davvero aperta) — non
     più dedotto dalla sola variazione di `visualViewport.height`, che
     sparava (con valori transitori sbagliati) anche al cold-launch e al
     resume da background.
   - **`status-bar-style` è `black-translucent`** (era `default`):
     confermato dall'utente che la cima è ora crema. Il rifiuto
     precedente (3 settembre) era causato dal bug qui sopra, non da un
     limite di iOS.
   - **La "fascia nera in fondo" non era canvas nativo non dipinto**:
     campionando il pixel dallo screenshot del device risulta
     `rgb(16,16,16)` = `#111011`, cioè `--page-bg` in dark mode. Era lo
     sfondo di `body`, l'unico elemento dell'app che reagiva a
     `prefers-color-scheme`, mentre `html` e `.screen` sono crema fissi e
     non esiste alcun tema scuro (le 4 variabili `--page-*` erano usate
     solo lì). Il telefono dell'utente è in modalità scura, quindi ogni
     errore di altezza di `.screen` si vedeva come una fascia nera.
     Variabili e blocchi dark-mode **eliminati**, `body` ora è crema
     fisso: un eventuale divario residuo è invisibile.
   - **Causa radice dell'altezza**: due tentativi consecutivi hanno
     prodotto screenshot **identici pixel per pixel**, il che ha
     dimostrato che `-webkit-fill-available` risolveva sì, ma al valore
     sbagliato (`.screen` 734pt su 852pt). Anche il fix del 2 settembre
     (`9d64542`) era valido solo in `status-bar-style: default`, non in
     `black-translucent`+`viewport-fit=cover`. Ora `.screen` non usa
     **nessuna** unità di altezza: si stira fra `top:0` e `bottom:0`, che
     riempie il viewport senza risolvere nessuna lunghezza.
   - Verificato in locale con Chromium in dark mode (riproducibile,
     a differenza di tutto il resto): `body` è crema anche con
     `prefers-color-scheme: dark`, e `.screen` copre esattamente il
     viewport. **Confermato sul device**: la fascia scura è sparita e lo
     schermo è pieno fino in fondo.
   - **Spazio residuo in fondo** (sembrava "navbar troppo alta"): risolto
     facendo stampare all'app i propri numeri invece di dedurli dagli
     screenshot. Il device dice `win 793` su uno schermo da **852pt**, con
     `inset top 59`: in `black-translucent` iOS sposta l'origine della
     viewport a y=0 ma le lascia l'altezza che avrebbe avuto sotto la
     status bar, quindi la viewport finisce **59pt sopra il fondo fisico**.
     `.screen` la riempiva già perfettamente (`0→793`) — non ha mai avuto
     un bug di altezza, ed è per questo che `100dvh`,
     `-webkit-fill-available` e `top:0/bottom:0` davano tutti lo stesso
     risultato: risolvono tutti contro quella stessa viewport corta.
     Allungare `.screen` oltre quel bordo **non** funziona: iOS non dipinge
     nulla sotto la viewport, quindi la navbar finiva in una striscia non
     disegnata (etichette sparite, icone tagliate). Fix effettivo: restare
     dentro la viewport e togliere il padding inutile —
     `@media (display-mode: standalone){ .navbar{ padding-bottom:2px } }`,
     perché l'home indicator sta fuori dalla viewport e riservargli spazio
     nella navbar impilava spazio morto su spazio morto. Navbar 83→49pt.
     Restano ~59pt di striscia in fondo: non eliminabili in
     `black-translucent`, è il prezzo della status bar crema.
   - **Diagnosi precedente sbagliata, da non ripetere**: avevo concluso
     che `env(safe-area-inset-bottom)` fosse gonfiato a ~94pt. **Non lo
     è**: il device riporta 34, corretto. I tentativi di limitarlo con
     `min()` sembravano non avere effetto solo perché il service worker
     non consegnava il CSS — due bug sovrapposti. `env()` si usa normale.
4. **Fix layout "Uve principali" su più righe** (Esplora) — quando i
   chip delle uve vanno a capo, l'etichetta `.chip-label` di default ha
   un margine negativo (`-4px`, pensato per un solo rigo) che la incolla
   alla prima riga, mentre il gap tra riga 1 e riga 2 resta il gap
   normale del flex (7px): risultato, ritmo verticale incoerente.
   Stesso problema già risolto altrove (`#view-cellar`, `#elements-overlay`,
   `#filter-sheet` in `app.css`) con un override `margin:0 0 6px`
   — aggiunto `#view-explore` alla stessa regola invece di inventarne
   una nuova.

## Cose note, non (ancora) da rifare

- `status-bar-style` è `black-translucent` (non più `default`), `.screen`
  si stira fra `top:0` e `bottom:0` senza **nessuna** unità di altezza
  (`100dvh` e `-webkit-fill-available` sono stati entrambi scartati su
  device reale), e `body` è crema fisso senza dark mode. Se in futuro
  riappare grigio in alto o scuro in fondo, leggere `CLAUDE.md` per
  intero prima di ritoccare: sono bug distinti, già scambiati l'uno per
  l'altro più volte.
- `env()` funziona correttamente (inset 59 sopra, 34 sotto): si usa
  normale. La regola da **non** togliere è invece
  `@media (display-mode: standalone){ .screen{ bottom:calc(-1 * env(safe-area-inset-top, 0px)) } }`,
  che compensa la viewport corta di `black-translucent` — senza, la
  navbar resta 59pt sopra il fondo dello schermo.
- **Il service worker non consegnava gli aggiornamenti.** Il fetch
  handler passava un init object (`{ cache: 'no-store' }`) a `fetch()`,
  che fa ricostruire la Request: su una richiesta `mode:"navigate"` questo
  lancia, e ogni eccezione cadeva nel `.catch()` che serve la cache. Per
  questo quattro deploy di fila non hanno cambiato **niente** sul device,
  anche con un `padding` statico. Ora è `fetch(event.request)` nudo,
  **senza init object**: non rimetterlo. Aggiunti anche
  `skipWaiting()`/`clients.claim()`.
- **La schermata Profilo mostra `build NN` in fondo**, allineato a `CACHE`
  in `sw.js`: serve a sapere da uno screenshot quale versione gira
  davvero. Alzarlo insieme a `CACHE` ad ogni cambio dello shell.
- **In corso (build 62)**: quella riga porta temporaneamente anche dei
  numeri diagnostici (`win`, `vv`, `screen top→bottom`, altezza e padding
  della navbar, safe-area insets reali) — vedi `renderBuildLine()` in
  `main.js`. Serve a capire perché in fondo resta spazio: build 61 ha
  dimostrato che il `padding` statico della navbar **arriva** al device
  eppure non sposta nulla, quindi la navbar non è alta 141pt — è `.screen`
  che non arriva in fondo, e il suo bordo è invisibile ora che `body` è
  crema. **Rimuovere la diagnostica** una volta risolto, lasciando solo
  `build NN`.
- Prima di teorizzare su una zona "non dipinta": **campionare il colore
  del pixel** dallo screenshot del device. `#000000` = canvas nativo,
  qualsiasi altro colore = un elemento dell'app. Questo singolo controllo
  avrebbe risparmiato settimane di diagnosi sbagliata. Stessa logica per
  le dimensioni: misurare le coordinate nello screenshot e confrontarle
  con Playwright in locale dà il valore che iOS sta riportando, invece di
  indovinarlo.
- Dentro ogni mappa, le regioni senza dati curati sono deliberatamente
  "dati in arrivo" invece di contenuto inventato — vale per tutti i
  paesi, non solo l'Italia.
- Portogallo/Argentina/Cile/Sudafrica sono senza mappa per mancanza di
  una fonte dati affidabile (vedi sopra), non per scelta di design — se
  si trova un pacchetto npm con i confini regionali di uno di questi, si
  può aggiungere seguendo lo stesso pattern di `wine-atlas.js`.

## Prossimi passi possibili (non richiesti, solo spunti)

- Ampliare la copertura regionale nei paesi con mappa (oggi solo un
  sottoinsieme di regioni/stati ha dati curati).
- Cercare una fonte per i confini di Portogallo/Argentina/Cile (es. un
  file GeoJSON/TopoJSON esterno, non solo pacchetti npm).
- Valutare se aprire una vera PR invece di push diretti su `master`.
- Se il deploy manuale diventa scomodo, si può passare a un trigger
  automatico su push a `master` nello stesso workflow (attualmente
  `workflow_dispatch` di proposito, per non deployare a ogni commit).
