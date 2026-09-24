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
9. **Fusione tab Vini/Uve in Esplora** — su richiesta esplicita ("fondere
   vini con uve... clicco su un vino, si espande e vedo le uve che lo
   compongono"). Il tab "Uve" a sé stante (lista piatta delle 3 uve
   principali della regione, senza legame con quale vino le usa) è stato
   tolto. Ogni riga vino in `explore.js`/`detailTemplate()` ora è un
   `.wine-item` (row `.wine-row` cliccabile + pannello `.wine-grapes`
   inizialmente chiuso) che si espande in loco mostrando le uve di
   **quel** vino specifico, come chip colorati (`.grape-chip`, riusa
   `GRAPE_COLOR`/`TYPE_COLOR` già esistenti per il pallino). Il segmentato
   è sceso da 3 a 2 pulsanti (Vini/Categorie). Wiring via delegazione su
   `#explore-detail` (`toggleWineGrapes()`), stesso pattern di
   `selectDetailTab()`.
   - **Perché `.wine-item` e non solo `.list-row`**: `.list-row` ha una
     regola condivisa `:last-of-type{border-bottom:none}` che, se il
     pannello uve fosse un fratello diretto di `.list-row`, romperebbe
     quella regola per OGNI riga (ognuna sarebbe l'unico `.list-row`
     dentro il proprio genitore). Il bordo separatore vive quindi su
     `.wine-item`, non più su `.list-row` dentro Esplora — vedi
     `CLAUDE.md` per il dettaglio, è un'insidia riusabile.
   - **Dato aggiunto**: campo `grapes` per-vino (array, supporta blend
     multi-uva) su tutti i **523 vini** dei 59 dataset in `wine-atlas.js`
     — prima esisteva solo un `grapes` regione-level con 3 uve generiche,
     ora inutilizzato (lasciato nei dati, non rimosso, per non rifare un
     edit di massa su 59 dataset senza motivo). Scritto da 9 agenti
     paralleli in background (stesso schema geografico della verifica web
     del punto 7: Italia Nord, Italia Centro-Sud, Francia, Spagna,
     Germania, Stati Uniti, Australia, Nazionali senza mappa, più un nono
     agente di fix mirato — vedi sotto), verificato via ricerche web
     mirate contro disciplinari/cahiers des charges/DO/AVA/GI ufficiali
     per le denominazioni meno note. **109 uve nuove** (non ancora in
     `GRAPE_COLOR`) raccolte e aggiunte alla tabella in `explore.js` (108
     effettive, 1 duplicato — "Viognier" — scartato). Merge fatto con
     script Node (`Function('return '+objText)()` per parsare/riscrivere
     l'oggetto letterale, JSON.parse/stringify per `wine-atlas.js`),
     **verificato con diff strutturale che l'unico campo cambiato sia
     `grapes[]`** (stesso metodo del punto 7) e che tutti i 523 vini
     abbiano un array non vuoto — nessuno è rimasto sul fallback
     "Composizione non disponibile".
   - **Bug trovato durante il merge, non durante la scrittura dei dati**:
     gli id regione "wa" **collidono** tra Stati Uniti (Washington) e
     Australia (Western Australia) — sono paesi diversi ma usano lo
     stesso id regionale breve. Il primo script di partizionamento (batch
     per gli agenti) indicizzava tutti i dataset in una mappa piatta per
     `id` **senza tenere conto del paese**, quindi il batch "usa" ha
     ricevuto per errore la lista vini della Western Australia invece di
     quella del Washington reale (l'agente stesso se n'è accorto e l'ha
     segnalato, elaborando comunque quello che gli era stato dato). Fix:
     un agente dedicato ha rifatto la ricerca sui 10 vini reali del
     Washington, e lo script di merge finale applica ogni file-risultato
     **scoperto per paese esplicito** (`{file: countryId}`), mai per id
     regione nudo condiviso globalmente — vedi `CLAUDE.md` per la
     lezione generale (id brevi non sono garantiti unici tra paesi
     diversi in questo dataset).
10. **Profilo di gusto per le note di degustazione** — implementato dopo
    un giro di mockup su canvas (vedi punto 9 per lo stile: card icona per
    categoria, riprese da "Ricco visivo"). Ogni nota di degustazione
    (testo + stelle, già esistente) può ora includere anche: chip di
    sapore raggruppati per categoria (Frutta/Floreale/Spezie/Legno/Altro),
    4 slider di gusto trascinabili (Piatto↔Acidulo, Secco↔Dolce,
    Morbido↔Tannico, Leggero↔Strutturato), e chip di abbinamento cibo —
    tutto opzionale. Nuovo modulo condiviso
    `public/js/tasting-profile.js` (`tastingProfileHtml()`,
    `wireTastingProfile()`, `resetTastingProfile()`, `readTastingProfile()`,
    `isTastingProfileEmpty()`, `tasteSummary()`) montato identico sia nel
    foglio "Rivedi e conferma" (`add.js`, dietro `#recognize-taste`) sia
    nella scheda dettaglio bottiglia (`detail.js`, dietro `#detail-taste`)
    — stesso componente, non due implementazioni.
    - **Migrazione `0006_tasting_profile.sql`**: aggiunge a
      `tasting_notes` le colonne `flavor_tags`/`food_pairings` (JSON
      testo, non esiste un tipo array in D1) e 4 colonne intere
      `taste_acidity`/`taste_sweetness`/`taste_tannin`/`taste_body`
      (0-100). `worker/src/routes/notes.ts` valida i nuovi campi
      (array ≤20 elementi, ogni stringa ≤40 char; interi 0-100) e
      parsa i JSON in array veri nella risposta (funzione `parseNote`).
    - **`text` non è più obbligatorio** nella nota: prima il backend
      rifiutava un testo vuoto con 400, ora una nota può esistere anche
      solo con chip/slider/abbinamenti (o solo un rating). Il rating
      resta 0-5; se non ci sono stelle selezionate resta il default a 3
      **solo se c'è del testo** (comportamento originale invariato),
      altrimenti resta genuinamente 0 (non inventato) — vedi il
      commento in `detail.js`/`add.js` accanto a questo calcolo.
    - **"Modifica" su una bottiglia in cantina, finalmente collegata**:
      `cellar.js` aveva già un'icona a matita `.edit-btn` su ogni riga,
      presente nel markup ma mai wired a nulla. Ora apre lo stesso
      foglio "Rivedi e conferma" (`openEditWineSheet(bottle, onSaved)`,
      esportata da `add.js`), precompilato con **tutti** i campi del
      vino esistente (non solo nome/produttore) via `PATCH
      /api/wines/:id` — nuovo endpoint, non esisteva prima.
      `onSaved` è `() => loadCellarData()`, per rinfrescare la lista
      subito dopo. La nota di degustazione in quel foglio parte sempre
      vuota anche in modalità modifica (non c'è una nota "corrente" da
      precompilare: le note sono voci di diario append-only, non un
      record mutabile — editare i dati del vino e scrivere una nuova
      nota di degustazione sono due azioni distinte che capitano solo
      di condividere lo stesso foglio).
    - **`PATCH /api/wines/:id` fa un overwrite completo, non un
      coalesce**: a differenza di `PATCH /api/bottles/:id` (che usa
      `coalesce(?, colonna)` per aggiornare solo i campi inviati), qui
      il form invia sempre lo stato intero, quindi un campo opzionale
      (regione/annata/vitigno/denominazione) svuotato deve arrivare al
      DB come NULL — cosa che `coalesce` non può mai fare (non
      distingue "campo omesso" da "campo esplicitamente svuotato").
      Controllo di accesso: chiunque abbia quel vino in una cantina di
      cui è membro può modificarlo (query su `bottles`+`cellar_members`
      per `wine_id`), non solo chi l'ha creato — è un catalogo
      condiviso fra cantine, non un record per-utente.
    - **Bug corretto durante l'implementazione, non prima**: la nuova
      nota nel foglio "Rivedi e conferma" ha il suo gruppo di stelle
      (`#rec-note-stars`), separato da quello della scheda dettaglio
      (`#note-text` + `.stars-input` in `#detail-overlay`). Il wiring
      esistente in `detail.js` selezionava `.stars-input span`
      **globalmente su tutto il documento** — con due gruppi di stelle
      ora presenti insieme nel DOM (uno per foglio, entrambi sempre
      presenti anche se solo uno è visibile), un click in un gruppo
      avrebbe acceso/spento le stelle dell'**altro** gruppo insieme al
      proprio. Corretto iterando `.stars-input` come contenitori
      separati e scopando la ricerca `span` a ciascuno.
    - Testato in locale con `wrangler dev` + Playwright sulle tre
      strade (aggiunta manuale con profilo, modifica vino da matita in
      Cantina con verifica campi precompilati e nota sempre vuota, nota
      di degustazione dalla scheda dettaglio) e con la suite di test
      del worker (120 test, inclusi 7 nuovi/aggiornati per `notes.ts` e
      4 nuovi per `PATCH /api/wines/:id`).
11. **Icona della schermata Home (iOS)** — `index.html` non aveva
    **nessun** tag `apple-touch-icon`: salvando la PWA sulla Home, iOS
    generava uno screenshot della pagina invece di un'icona. Aggiunto il
    tag mancante e sostituito il marchio.
    - **Il disegno non è più il bicchiere disegnato a mano**: dopo
      quattro giri di mockup tutti bocciati dall'utente (bicchiere,
      bottiglia/grappolo geometrici, versioni "che riempiono la
      cornice", calice a tratto in sei varianti — il canvas sta su
      `https://claude.ai/artifact/FDRzP9vgmAjMs2i7qdXzQh`), l'utente ha
      scelto un'icona di Flaticon: grappolo + calice a tratto.
    - **Licenza**: Flaticon free, *"Wine icons created by iconixar -
      Flaticon"*, che **obbliga all'attribuzione**. Il credito è in
      Profilo sotto la riga `build` (`.app-credit` in `index.html`,
      stile in `app.css`) e **non va tolto** finché l'icona resta questa.
    - **Asset generati con Pillow** dal PNG originale 512×512 (tratto
      nero su trasparente): ricolorato crema `#f7f5f0` su fondo pieno
      bordeaux `#5b2333`, arte al 74% della cornice. Rigenerati
      `apple-touch-icon.png` (180), `icon-192.png` e `icon-512.png` così
      manifest e Home restano coerenti — i vecchi tre erano il bicchiere
      silhouette.
    - **Limite noto e accettato**: a 29×29 px (Impostazioni) il disegno
      impasta, perché ha due soggetti e otto acini. Provato a ingrassare
      il tratto per compensare: peggiora, chiude gli acini del grappolo.
      Sulla Home a 60 px — la misura che conta — regge.
12. **Ricerca web in "Aggiungi vino": via i duplicati di lingua** —
    segnalazione utente ("perché vedo record di Vivino Spagna?"). Erano
    due cose sovrapposte: soprattutto la **stessa** scheda Vivino
    ripetuta in più lingue (`/it/`, `/en/`, `/es/`), che occupava fino a
    tre delle dieci righe del selettore, e in misura minore vini
    davvero spagnoli passati dal filtro di pertinenza.
    - Aggiunta `dedupeKey()` in `tavily-search.ts`: raggruppa per l'id
      `/w/<id>` (stabile fra le lingue) e tiene una sola scheda. Gira
      **dopo** l'ordinamento, così sopravvive la copia meglio piazzata —
      la `/it/`, grazie a `ITALIAN_PATH_BOOST` che prima si limitava a
      riordinare senza togliere niente. L'`?year=` è nella chiave: due
      annate sono due bottiglie diverse.
    - Tolto il suffisso `vino` dalla query: inutile con la ricerca già
      ristretta a Vivino, ed è parola spagnola quanto italiana.
    - **Non** toccato `isRelevant()`, che continua a chiedere una sola
      parola (la più lunga): stringerlo a due parole è l'unica modifica
      di quest'area che può ridurre il recall, quindi va misurata prima.
      Vedi `CLAUDE.md` per il dettaglio dei due filtri.
    - **Bug trovato provando le query reali dell'utente prima del
      deploy** ("batude di tenuta Ambrosini", "Zamuner blanc de blanc"):
      il primo giro di deduplica lasciava scegliere al boost *quale*
      copia tenere, e con score 0.78 (ES) contro 0.72 (IT) sopravviveva
      la spagnola — diventando l'unica riga visibile, cioè peggio di
      prima. Ora la lingua si sceglie in modo deterministico dentro il
      gruppo; la score decide solo la posizione fra vini diversi.
    - **Limite noto, non risolto**: su "batude di tenuta Ambrosini" la
      parola distintiva è `ambrosini` e non `batude`, quindi se la
      scheda Vivino non nomina il produttore il vino giusto viene
      scartato. C'è un test che lo fissa; il rimedio per l'utente è
      cercare il solo nome del vino. Vedi `CLAUDE.md`.
    - **Secondo giro, dagli screenshot dell'utente in produzione**: la
      deduplica funzionava (nessun doppione di lingua nelle due liste),
      ma sono emersi due difetti nuovi e uno vecchio.
      `isWinePage()` scarta ora le pagine senza id `/w/` — erano schede
      cantina ("Ambrosini Winery", "Zamuner Winery") che, toccate,
      avrebbero salvato un vino con quel nome. `cleanTitle()` toglie il
      suffisso di sito dal titolo ("| Vivino English", "| Vivino
      Italiano", "- Vivino"), che essendo la fonte del nome precompilato
      sarebbe finito in cantina.
    - **`ITALIAN_PATH_BOOST` rimosso del tutto.** Risolta la lingua
      dentro la deduplica e scartate le pagine senza id, restava solo a
      riordinare vini diversi — visto mettere una pagina italiana da
      0.84 sopra una da 0.88. Ora la score ordina i vini e la deduplica
      sceglie la lingua, senza sommare niente alla score.
    - **Terzo giro, verificando su Vivino il vino che non usciva.** Il
      Batudè di Tenuta Ambrosini **c'è**
      (`vivino.com/IT/it/ambrosini-franciacorta-batude/w/2667819`), e
      cercarlo ha fatto emergere due bug nostri:
      `isItalianVivinoUrl()` faceva `startsWith('/it/')` e non
      riconosceva la forma `/IT/it/` (né `/BR/pt-BR/`), quindi la
      preferenza per l'italiano non scattava mai in produzione; e il
      confronto di pertinenza era sensibile agli accenti, mentre il vino
      si chiama "Batudè" ma ha slug `…-batude`. Aggiunto `fold()` su
      entrambi i lati.
    - **Perché "Batude" dava zero resta però un limite di Tavily**, non
      un nostro filtro: la scheda esiste su Vivino ma Tavily non la
      restituisce per quella query. Se ricapita su altri vini, l'ipotesi
      da valutare è allargare `SEARCH_DOMAINS` — ma attenzione, era già
      stato provato e aveva azzerato il recall su Zamuner (vedi il
      commento nel file prima di rifarlo).
    - `worker/test/tavily-search.test.ts`: 24 test, suite completa 129
      verdi. Diversi fixture storici usavano URL Vivino senza `/w/`
      (`/p/1`, `/a`, `/barolo`): allineati a URL reali, altrimenti
      sarebbero stati scartati da `isWinePage()`.
13. **Cancellare la ricerca mostrava vini a caso** — segnalazione utente
    con screenshot: casella vuota, "Risultati (6)", tutto il catalogo.
    Due bug sommati, entrambi corretti (dettaglio in `CLAUDE.md`):
    `GET /api/wines/search` con `q` vuoto costruiva `like '%%'`, che
    matcha ogni riga e restituiva l'intero catalogo — ora torna `[]`; e
    `runSearch()` in `add.js` non ricontrollava dopo l'`await` che la
    query fosse ancora quella corrente, così la risposta di una query
    intermedia ancora in volo ridisegnava la lista appena svuotata.
    - Race riprodotta in modo deterministico con Playwright + stub
      `page.route` con ritardo artificiale, servendo `public/` con
      `python3 -m http.server` (niente wrangler): senza guardia la lista
      torna a 3 righe dopo la cancellazione, con guardia resta vuota.
    - `CACHE` a `v78` e `build 78` (toccato un file dello shell).
    - Nuovo test in `worker/test/wines.test.ts` per il `q` vuoto; suite
      completa 130 verdi.
14. **Riga "Aiuto" troncata in Profilo** — segnalazione utente con
    screenshot: l'ultima riga di `.settings-list` mostrava solo un
    frammento di bordo invece di icona/etichetta/chevron. Non un bug di
    codice/CSS (markup e stili delle 4 righe sono identici in struttura)
    ma un difetto di repaint specifico di WebKit: `.settings-list` ha
    `border-radius`+`overflow:hidden` dentro `.view`, che ha
    `-webkit-overflow-scrolling:touch`, e sopra di lei "Persone che
    segui" cambia altezza in modo asincrono (skeleton → contenuto reale,
    misurato con Playwright: **62px** di scarto) *dopo* il primo paint —
    precondizioni tutte verificate per il bug noto in cui Safari non
    ridipinge correttamente l'ultimo elemento di un box del genere dopo
    che un fratello sopra si è ridimensionato. **Non riproducibile in
    Chromium/Playwright** (confermato: layout identico prima/dopo il
    fix in locale), quindi la diagnosi si è fermata a "precondizioni
    presenti, rimedio noto" — va confermato su device reale.
    - Fix tentato: `transform:translateZ(0)` su `.settings-list` (forza
      un layer di compositing persistente, nessun effetto visivo). Vedi
      `CLAUDE.md` per il dettaglio e il rimedio da riusare se ricompare
      altrove (`.compare-col` ha la stessa forma a rischio).
    - `CACHE` a `v79` e `build 79`.
    - **Aggiornamento, sessione successiva: il problema resta** dopo il
      deploy della v79 (segnalato dall'utente, senza un nuovo
      screenshot). `translateZ(0)` era il rimedio storico giusto per la
      classe di bug ipotizzata, ma **non ha risolto** — quindi o la
      diagnosi (repaint WebKit su `.settings-list` dopo il reflow di
      "Persone che segui") era sbagliata, o è giusta ma serve un rimedio
      diverso. **Non riprovare alla cieca un terzo fix**: la prossima
      sessione deve chiedere un nuovo screenshot (idealmente con la riga
      diagnostica se serve isolare meglio) prima di toccare di nuovo
      quel CSS — vedi "Come misurare invece di indovinare" in
      `CLAUDE.md`, che questa stessa vicenda ripete.

15. **Spaziatura build/credito in Profilo, ravvicinata** — richiesta
    esplicita dell'utente: `build NN` e la riga di attribuzione Flaticon
    erano entrambe figlie dirette di `.view`, quindi prendevano ciascuna
    il gap di 20px del flex della vista — troppa aria tra due righe che
    sono concettualmente un blocco unico. Raggruppate in un wrapper
    `.app-footer` con gap interno di 2px; il gap Esci→footer resta
    invariato. `CACHE` a `v80`, `build 80`.
16. **Foto enorme nel picker "scegli la bottiglia"** (Elementi cantina,
    slot vuoto → assegna una bottiglia) — segnalazione utente: voleva la
    stessa lista compatta della Cantina. Causa reale, non estetica:
    `renderBottlePickerForSlot()` in `cellar.js` riusa già la classe
    `cphoto` dentro `.elem-row`, ma la regola di dimensione compatta era
    scoped **solo** a `.cellar-row .cphoto` — per `.elem-row .cphoto`
    non esisteva nessuna regola, quindi l'`<img>` renderizzava a
    dimensione naturale. Aggiunta `.elem-row .cphoto` con le stesse
    misure (34×48px). Non tocca l'altro uso di `.elem-row` (la lista
    degli elementi cantina stessi), che usa `.elem-icon`, non `.cphoto`.
    Verificato con Playwright: 34×48px prima/dopo, screenshot identico
    alla riga della Cantina. `CACHE` a `v81`, `build 81`.

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
