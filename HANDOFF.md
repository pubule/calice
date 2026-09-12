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
5. **Redesign Home** ("troppo ricca e caotica") — dopo un giro di mockup
   su una canvas di design (tre direzioni), scelta quella con tab. Tolto
   `.hero`/`.ring` (i tre numeri sono una riga semplice), `.explore-entry`
   non è più una card bianca (solo hairline sopra/sotto), e le tre sezioni
   "Da bere presto"/"Regioni principali"/"Attività amici" sono diventate
   un segmentato (riusa `.segmented` di Cantina) con un pannello alla
   volta — "Da bere" ora usa `.list-row` invece delle vecchie card
   fotografiche `.wine-card` (mai state cliccabili comunque, rimosse come
   CSS morto insieme a `.scroller`/`.card-photo`/`.card-body`). Il tab si
   azzera su "Da bere" ad ogni ingresso in Home.
   - **Bug trovato e fisso durante l'implementazione**: i pannelli
     nascosti con l'attributo nativo `hidden` restavano visibili tutti
     insieme, perché una regola d'autore con `display` (la mia
     `.home-tab-panel{display:flex}`) batte sempre lo user-agent
     stylesheet dove vive `[hidden]{display:none}` — a prescindere dalla
     specificità. Il progetto non usa mai `hidden` nudo altrove (usa una
     classe `.hidden{display:none}`, es. `.camera-shutter-wrap.hidden`):
     adeguato a quella convenzione. Vedi `CLAUDE.md` per il dettaglio —
     è un'insidia facile da ripetere se in futuro si nasconde qualcos'altro
     con l'attributo nativo.
   - **Fix successivo**: `.explore-entry .sub` aveva solo `margin-top:2px`
     — le mancavano `font-size`/`color` che ogni altra variante di `.sub`
     nel file definisce (10.5px, `#8f8474`). Ereditava quindi il testo
     normale (grande, scuro) invece della didascalia piccola e grigia del
     mockup. Bug preesistente da quando `.explore-entry` era ancora una
     card bianca, rimasto nascosto finché non gli si è tolta intorno la
     card in questo stesso redesign.
6. **Tab nella card dettaglio regione + vini portati a top 10** (Esplora)
   — su richiesta esplicita. La card regione ora ha lo stesso pattern a
   tab di Home (`Vini` / `Uve` / `Categorie`, un pannello alla volta,
   riusa `.segmented`); il tab si azzera su "Vini" ad ogni cambio
   regione/paese, wiring via delegazione su `#explore-detail` visto che
   il suo `innerHTML` viene rigenerato ad ogni selezione (stesso motivo
   per cui Home usa la stessa tecnica). `#view-explore .chip-label` è
   diventata morta con questo cambio (non c'è più nessun `.chip-label`
   nel template) ed è stata tolta dalla regola condivisa in `app.css`.
   Il tab "Uve" è stato poi allineato allo stile del tab "Vini" su
   richiesta esplicita: da chip a pillola (`.chip`, layout orizzontale)
   a `.list-row`/`.lbody`/`.lname` (elenco verticale con separatori),
   stessa classe già usata dai vini. L'utente ha poi chiesto anche il
   pallino colorato (`.type-dot`) come per i vini — ma le uve in
   `wine-atlas.js` sono stringhe semplici, senza colore/tipo associato.
   Aggiunta in `explore.js` una tabella `GRAPE_COLOR` (101 voci, tutte
   le uve uniche usate nel dataset → `rosso`/`bianco` a bacca, non
   `bollicine`/`rosato` che sono categorie di vino non di vitigno)
   classificata da conoscenza ampelologica diretta (fatto botanico
   stabile, non soggetto a promozioni/declassamenti come i DOC/DOCG,
   quindi non serve verifica web) — verificato con uno script che ogni
   uva presente nel dataset abbia una voce nella tabella (nessuna cade
   sul fallback). Le uve a bacca rosa vinificate in bianco
   (Gewürztraminer, Pinot Gris, Malvasia) sono classificate `bianco`,
   coerentemente con come i vini fatti da quelle uve sono già tipizzati
   altrove nel dataset.
   - **Liste vini espanse da 1-3 a fino a 10 per regione/paese**, in
     `wine-atlas.js`. Solo aggiunte in coda — le entry già curate (le
     prime 1-3 per regione) sono rimaste **byte-identiche**, verificato
     via diff strutturale prima di scrivere il file. Copertura risultante
     (59 dataset totali tra regioni-con-mappa e paesi nazionali):
     **44 arrivano a 10**; il resto si ferma onestamente più in basso
     dove la regione non ha davvero altrettante denominazioni/GI/AVA
     distinte e riconosciute (Basilicata 5, Molise 6, Corse e Occitanie
     9, Andalucía 6, País Vasco 4, Galicia 5, La Rioja 5, Región de
     Murcia 3, Navarra 4, Comunidad Valenciana 4, Baviera/Franken 8,
     Sassonia 4, New York 8, Texas 6, Virginia 8) — stessa logica di
     "dati in arrivo" invece di contenuto inventato già in uso per le
     regioni senza dati.
   - Dati scritti a mano da conoscenza enologica diretta (nessuna
     ricerca web), poi verificati con uno script: nessun duplicato per
     regione, nessun campo mancante, nessun `type` fuori dall'insieme
     valido (`rosso`/`bianco`/`bollicine`/`rosato`).
7. **Verifica web della lista vini/uve** — 8 agenti in parallelo (uno per
   Italia×2, Francia, Spagna, Germania, Stati Uniti, Australia, paesi
   nazionali), ciascuno con ~10-15 ricerche web mirate contro fonti
   ufficiali (disciplinari DOC/DOCG, INAO, consorzi DO, Wine Australia
   GI register, TTB, Wikipedia). **23 correzioni applicate**, tutte solo
   sostituzioni puntuali (nome/appellation/type/uva), mai riscritture
   intere — verificato via diff strutturale che nient'altro sia cambiato:
   - Appellation sbagliata (il nome "semplice" era DOCG/DOC quando in
     realtà solo una sotto-denominazione lo è): Prosecco e Soave in
     Veneto (DOCG→DOC, il DOCG è solo "Superiore"), Castel del Monte in
     Puglia (DOCG→DOC), Frascati nel Lazio (DOCG→DOC, il DOCG è solo
     "Superiore"/"Cannellino"); Casauria in Abruzzo (DOC→DOCG, promossa
     nel 2025); due vini di Pago in Castilla-La Mancha (DO→VP, categoria
     spagnola distinta e superiore al DO).
   - Type sbagliato: Ribolla Gialla in Friuli (bollicine→bianco, è
     prevalentemente ferma), Cerasuolo di Vittoria in Sicilia
     (rosato→rosso, il disciplinare lo classifica rosso nonostante il
     nome), Gaillac in Occitania (bianco→rosso, maggioranza rossa),
     Tierra del Vino de Zamora in Castilla y León (bianco→rosso), Anjou
     in Pays de la Loire (rosato→bianco, il rosé ha una AOC a parte).
   - Regione geografica sbagliata: Madiran spostato da Nouvelle-Aquitaine
     a Occitanie (il comune e il cuore storico della denominazione sono
     in Occitania).
   - Nome duplicato/ridondante: "Cafayate Torrontés" in Argentina
     rimosso (stessa area di "Salta Torrontés", non una regione
     distinta) — Argentina scende onestamente da 10 a 9.
   - Uve non rappresentative (sostituite con quelle davvero principali
     per ettari/riconoscibilità, secondo le fonti): Verdeca→Nero di
     Troia (Puglia), Moscato→Greco (Basilicata), Cariañena→Cariñena
     (Catalogna, era solo un refuso), Macabeo→Merseguera (Valencia),
     Viognier→Cabernet Sauvignon (Texas), Viognier+Petit
     Verdot→Chardonnay+Merlot (Virginia, tenuto Cabernet Franc), Pinot
     Meunier→Sauvignon Blanc (Tasmania), Alvarinho→Touriga Franca
     (Portogallo).
   - Rinominato "Navarra" in "Navarra Rosado" (senza cambiare `type`)
     per evitare un doppione di fatto con "Navarra Tinto" già aggiunto,
     dato che la DO base non è più a maggioranza rosé.
   - **Non toccato deliberatamente** (segnalato dagli agenti come caso
     limite o convenzione consolidata, non errore): Cabernet Sauvignon
     come 3° vitigno in Argentina, Pinotage in Sudafrica, Carménère in
     Cile — tutti minoritari per ettari coltivati ma è così che vengono
     comunemente identificati quei paesi nel mercato del vino; Jerez
     come "bianco" (è un vino fortificato, lo schema dell'app non ha una
     categoria dedicata); Sierras de Málaga (DO con produzione mista,
     confidenza bassa sulla correzione).
8. **Transizione di caricamento Home/Statistiche + crossfade di
   navigazione** — segnalato dall'utente: "la pagina si carica a pezzi e
   si vede". Prima di implementare, tre mockup HTML (dissolvenza
   semplice, fade+assestamento, tutto insieme a cascata scaglionata)
   mostrati su una canvas; scelta iniziale la terza (cascata ~55ms per
   sezione). Causa reale in `home.js`: `mountHome()` faceva quattro
   `await` in sequenza (utente → cantina → bottiglie → attività), quindi
   il nome compariva ~subito e il resto arrivava in momenti diversi tra
   loro — non un problema di CSS ma di come i dati venivano richiesti.
   - Le quattro chiamate ora partono in parallelo con un unico
     `Promise.all` (la dipendenza cantina→bottiglie resta annidata dentro
     un solo branch, le altre tre sono indipendenti): tutti i dati sono
     pronti nello stesso istante, non più sfalsati. Stessa cosa già vera
     in `stats.js` (un solo blocco di rendering dopo l'unica catena di
     await necessaria — cantina→bottiglie è una dipendenza vera, non
     parallelizzabile).
   - **Rivisto dopo il primo giro**: la cascata scaglionata (55ms per
     sezione) è stata provata su device e giudicata dall'utente
     "macchinosa" — voleva la pagina **tutta visibile insieme** a dati
     pronti, non a pezzi anche solo di 55ms. `revealSections()`
     (`home.js`/`stats.js`) ora aggiunge `revealed` a **tutte** le
     sezioni nello stesso `requestAnimationFrame`: un solo fade+translateY
     per l'intera pagina (CSS `.reveal-target`/`.revealed` in `app.css`,
     rispetta `prefers-reduced-motion`), non più una sequenza. **Non
     reintrodurre lo scaglionamento** senza che l'utente lo richieda di
     nuovo esplicitamente.
   - **Cantina (`cellar.js`) lasciata invariata deliberatamente**: la
     schermata principale è un'unica lista (non widget separati come
     Home), quindi non ha lo stesso sintomo — l'unica sequenza di await
     lì (bottiglie → elementi → wishlist) alimenta rispettivamente la
     lista principale, un overlay chiuso di default, e un tab non attivo
     di default.
   - **Nuovo, stessa richiesta**: l'utente ha chiesto anche che la
     *navigazione* tra schermate sia "molto smooth" e dia "un'idea di
     solidità" — non solo il caricamento dati di una singola schermata.
     Aggiunto un crossfade in `showView()` (`main.js`): `.view.active`
     parte a `opacity:0`, poi un `requestAnimationFrame` dopo aggiunge
     `.shown` che porta l'opacità a 1 (~180ms, CSS in `app.css`) — ogni
     cambio vista è ora un fade-in invece di uno scatto
     `display:none`→`flex` istantaneo.
   - Verificato in locale (`wrangler dev` + Playwright, endpoint
     `/api/cellars/*/bottles` e `/api/me/activity` rallentati
     artificialmente): tutti gli eventi `revealed` arrivano nello stesso
     istante (non più scaglionati), e il crossfade di navigazione mostra
     un'opacità intermedia (~0.26) a metà transizione prima di
     assestarsi su 1.
9. **IN CORSO — fusione tab Vini/Uve in Esplora (vedi "cose note" per lo
   stato esatto)**: su richiesta esplicita ("fondere vini con uve...
   clicco su un vino, si espande e vedo le uve che lo compongono"), il tab
   "Uve" a sé stante (lista piatta delle 3 uve principali della regione,
   senza legame con quale vino le usa) è stato tolto. Ogni riga vino in
   `explore.js`/`detailTemplate()` ora è un `.wine-item` (row `.wine-row`
   cliccabile + pannello `.wine-grapes` inizialmente chiuso) che si espande
   in loco mostrando le uve di **quel** vino specifico, come chip colorati
   (`.grape-chip`, riusa `GRAPE_COLOR`/`TYPE_COLOR` già esistenti per il
   pallino). Il segmentato è sceso da 3 a 2 pulsanti (Vini/Categorie).
   Wiring via delegazione su `#explore-detail` (`toggleWineGrapes()`),
   stesso pattern di `selectDetailTab()`. Verificato in locale (Playwright):
   2 tab, chevron ruota all'apertura, click ripetuto apre/chiude,
   fallback "Composizione non disponibile" per vini senza dati.
   - **Perché `.wine-item` e non solo `.list-row`**: `.list-row` ha una
     regola condivisa `:last-of-type{border-bottom:none}` che, se il
     pannello uve fosse un fratello diretto di `.list-row`, romperebbe
     quella regola per OGNI riga (ognuna sarebbe l'unico `.list-row`
     dentro il proprio genitore). Il bordo separatore vive quindi su
     `.wine-item`, non più su `.list-row` dentro Esplora.
   - **Dato mancante, causa del blocco**: i vini in `wine-atlas.js` non
     avevano mai un campo `grapes` per-vino (solo un campo `grapes`
     regione-level con 3 uve, ora inutilizzato — lasciato nei dati, non
     rimosso, per non rifare un edit di massa su 59 dataset senza motivo).
     523 vini su 59 dataset necessitano di un array `grapes` reale
     (supporta blend multi-uva, non solo monovitigno — richiesto
     esplicitamente dall'utente). **Lanciati 8 agenti paralleli in
     background** (stesso schema geografico della verifica web del punto
     7: Italia Nord, Italia Centro-Sud, Francia, Spagna, Germania, Stati
     Uniti, Australia, Nazionali senza mappa), ciascuno con istruzioni di
     scrivere un JSON `{ datasetKey: { "Nome vino esatto": ["Uva1", "Uva2"] } }`
     più una mappa `_newGrapes` per le uve nuove non ancora in
     `GRAPE_COLOR`, verso file scratch in
     `/tmp/.../scratchpad/result-<batch>.json`. Un primo giro di 6 agenti
     su 8 è fallito per rate limit di sessione (`resets 10:40am UTC`) —
     rilanciati con successo dopo il reset. **A questo push, alcuni batch
     potrebbero non essere ancora tornati** — se riprendi questa sessione
     e trovi `wine-atlas.js` ancora senza `grapes` per-vino, controlla
     `/tmp/claude-0/-home-user-calice/*/scratchpad/result-*.json` (8 file
     attesi: italia-nord, italia-centro-sud, francia, spagna, germania,
     usa, australia, nazionali) — se mancano, rilanciare gli agenti
     mancanti con lo stesso schema (vedi `batch-*.json` nello stesso
     scratchpad per l'input già partizionato). Una volta tutti presenti,
     il passo finale è: scrivere uno script Node che (a) unisce ogni
     risultato nel campo `wines[].grapes` di `wine-atlas.js` per
     `datasetKey`+nome esatto, verificando che ogni vino riceva un array
     non vuoto e che nessun altro campo cambi (diff strutturale, stesso
     metodo del punto 7); (b) estende `GRAPE_COLOR` in `explore.js` con
     ogni voce di `_newGrapes` da tutti i batch. **Finché questo passo non
     è fatto, ogni vino nell'app mostra "Composizione non disponibile"
     invece delle uve reali** — la UI è già corretta e pronta, manca solo
     il dato.

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
  `@media (display-mode: standalone){ .navbar{ padding-bottom:2px } }`:
  con la viewport corta l'home indicator sta fuori, quindi riservargli
  spazio nella navbar aggiunge solo vuoto. E **non** riprovare ad
  allungare `.screen` oltre il bordo della viewport: iOS non dipinge lì.
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
  La diagnostica temporanea che stampava i numeri del device
  (`renderBuildLine()`) è stata **rimossa** una volta risolto il layout:
  resta solo `build NN`. I numeri che avevano chiuso il caso sono
  riportati in `CLAUDE.md`.
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
- Pattern di reveal a cascata (`.reveal-target`/`.revealed` in
  `app.css`, `revealSections()` in `home.js`/`stats.js`): riusarlo così
  com'è per qualunque altra schermata con più sezioni indipendenti che
  oggi appaiono in un unico blocco dopo l'ultimo `await`. Prerequisito:
  i dati vanno prima resi effettivamente simultanei (`Promise.all` al
  posto di `await` in sequenza) — la cascata è presentazione voluta, non
  un modo per camuffare un caricamento ancora sfalsato.

## Prossimi passi possibili (non richiesti, solo spunti)

- Ampliare la copertura regionale nei paesi con mappa (oggi solo un
  sottoinsieme di regioni/stati ha dati curati).
- Cercare una fonte per i confini di Portogallo/Argentina/Cile (es. un
  file GeoJSON/TopoJSON esterno, non solo pacchetti npm).
- Valutare se aprire una vera PR invece di push diretti su `master`.
- Se il deploy manuale diventa scomodo, si può passare a un trigger
  automatico su push a `master` nello stesso workflow (attualmente
  `workflow_dispatch` di proposito, per non deployare a ogni commit).
