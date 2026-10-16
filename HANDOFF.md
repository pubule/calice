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
17. **Sostituire/liberare uno slot occupato** — domanda esplicita
    dell'utente su come farlo; risposta onesta: **non si poteva**. Uno
    slot pieno apriva solo il popup "Apri ›" verso la scheda del vino
    lì dentro, nessuna opzione per liberarlo o metterci un altro vino.
    Il backend supportava già `PATCH /api/bottles/:id/location` con
    `elementId: null` (commento nel file: "unassigning an element or
    clearing a slot is a real, valid state") — mancava solo che il
    frontend lo chiamasse mai così.
    - `showBottlePopup()` in `cellar.js`: aggiunta una riga di azioni
      sotto quella esistente. **"Libera questo slot"** compare sempre
      (chiama `assignBottleToSlot(b, null, null, null, null)`, che è
      l'endpoint esistente con tutti i campi a `null` — nessun nuovo
      endpoint). **"Sostituisci con «X»"** compare solo quando si è nel
      flusso picker (aperto da "modifica posizione" sulla scheda di
      un'altra bottiglia) e lo slot toccato è occupato da un vino
      diverso da quello che si sta piazzando: libera prima l'occupante,
      poi assegna lì il vino del picker — due `PATCH` in sequenza, mai
      contemporaneamente sullo stesso slot lato server.
    - `.bottle-popup` in `app.css` passa da riga singola a due righe
      (`.bpop-main` + `.bpop-actions`, separate da un bordo sottile) per
      fare posto alle azioni senza affollare la riga esistente.
    - Verificato con Playwright end-to-end (rotta `/api/bottles/:id/location`
      stubbata per registrare le chiamate reali): "Libera" produce un
      solo `PATCH` con tutti i campi `null` e lo slot torna vuoto nella
      griglia; "Sostituisci" produce la sequenza `PATCH` libera-poi-assegna
      corretta e `loc-value` nella scheda della nuova bottiglia si
      aggiorna. Suite backend invariata (130 verdi, nessun endpoint
      nuovo). `CACHE` a `v82`, `build 82`.
18. **Audit UX automatizzato (Playwright, 21 schermate + scenario
    offline) — solo 2 bug reali confermati, il resto era rumore.**
    L'audit segnala moltissimi "target piccoli"/contrasto: quasi tutti
    sono lo stile compatto scelto deliberatamente in questo progetto
    (chip, pulsanti `.segmented`, icon-btn 25×25...), non toccati.
    Anche due letture inizialmente sospette si sono rivelate false piste
    una volta verificate: screenshot "prima/dopo scroll" identici
    byte-per-byte nella scheda dettaglio e nel foglio manuale erano un
    artefatto dello script di audit stesso (selettore CSS a lista,
    `'#detail-overlay .detail-sheet, #detail-overlay'` — `querySelector`
    su una lista di selettori restituisce il primo match in ordine di
    **documento**, non il primo della lista: prendeva l'overlay
    genitore, non scrollabile, invece del foglio interno), non un bug
    dell'app — verificato scrollando il foglio vero via Playwright
    (scrollTop passa da 0 a 525). Anche la schermata "Errore di
    connessione" offline è comportamento voluto (gate di autenticazione
    fallito), non un bug.
    - **Bug reale 1 — `.segmented button` selezionato senza scope**:
      `wireStaticControls()` in `cellar.js` wirava
      `document.querySelectorAll('.segmented button')` su **tutto il
      documento**, ma `.segmented` è la stessa classe usata dai tab
      Home (Da bere/Regioni/Attività). Cliccare un tab Home eseguiva
      comunque il branch `else` del listener della Cantina (nessun tab
      Home ha `data-wall`), che forzava `#wishlist-list` visibile e
      `#cellar-list` nascosto **in background** — invisibile finché non
      si tornava in Cantina, dove compariva "Desideri" al posto de "La
      mia cantina" pur con quel tab segnato attivo. Stesso bug già
      documentato in `CLAUDE.md` per `.stars-input`, ricomparso in un
      punto diverso. Riprodotto con uno script Playwright dedicato
      (click su un tab Home poi hash diretto a `#/cellar`) prima e dopo
      il fix. **Fix**: selettore scoped a `#view-cellar .segmented
      button`.
    - **Bug reale 2 — crash del fallback BarcodeDetector se il CDN non
      carica**: in `index.html`, il blocco che installa il polyfill
      zbar-wasm quando l'API nativa manca faceva
      `barcodeDetectorPolyfill.BarcodeDetectorPolyfill` senza controllare
      che gli script `<script src="https://cdn.jsdelivr.net/...">`
      sopra fossero effettivamente caricati. Con CDN bloccato/offline al
      primo load (osservato nel sandbox dell'audit, ma vale per
      qualunque ad/script blocker o down del CDN in produzione), quel
      riferimento lancia un `ReferenceError` non gestito. **Fix**:
      guardia `typeof barcodeDetectorPolyfill !== 'undefined'` prima
      dell'assegnazione — se manca, `window.BarcodeDetector` resta
      `undefined` e `add.js` (che già controlla `'BarcodeDetector' in
      window`) disattiva lo scan senza crash. Verificato con Playwright
      bloccando le richieste verso `cdn.jsdelivr.net`: zero `pageerror`,
      scansione disattivata correttamente.
    - Nessuna modifica backend. `CACHE` a `v83`, `build 83`.
19. **Audit secondo le Human Interface Guidelines di Apple + giro di fix
    con 5 agenti paralleli.** Metodo dalle skill
    `dickwu/apple-design-skill` (pagine HIG, 5 lenti, scala di gravità)
    ed `emilkowalski/skills` › `apple-design` (movimento, gesti,
    feedback). Giudizio iniziale: "Critical issues", soprattutto
    accessibilità. Ogni agente ha lavorato in un worktree separato; i
    rami sono stati uniti a mano su questo branch (conflitti solo in
    `app.css`, `index.html`, `home.js`, `profile.js`, `sw.js`, tutti
    risolti tenendo entrambe le parti).
    - **A — navigazione**: la scheda attiva del menu in basso si
      aggiornava solo al tocco (script inline in `index.html`, rimosso):
      ora la imposta `showView()` in `main.js` (`TAB_FOR_VIEW`: Esplora e
      invito accendono Home), con `aria-current="page"`. Nuova azione
      **"Stappa una bottiglia"** nella scheda del vino (`PATCH
      /api/bottles/:id` con `quantity−1`, già supportato dal backend ma
      mai usato) con Annulla per 5s; all'ultima bottiglia chiede conferma
      e cancella la riga. Conteggio Cantina "N vini · M bottiglie";
      "resta 1 bottiglia" al singolare in Home.
    - **B — leggibilità e tocco** (`app.css`, blocco `/* HIG: leggibilità
      e tocco */`): grigi del testo a `#736a5d` (≥4,5:1), stelle spente
      `#8e8779` (3:1, soglia icone), nessun testo sotto 11px, aree di
      tocco ≥44pt tramite `::after` trasparenti (attenzione agli antenati
      con `overflow:hidden`, vedi commento nel CSS), stato `:active` su
      tutti i controlli, fogli in sola dissolvenza con riduzione
      movimento. In `main.js` un `touchstart` vuoto: senza, iOS non
      applica `:active` ai `div`.
    - **C — VoiceOver**: `role`/`tabindex`/`aria-label` su tutti i
      controlli non nativi (prima 118 senza ruolo, 15 senza nome → 0),
      stelle come `radiogroup`, slider del gusto come `role="slider"` con
      frecce, handler globale Invio/Spazio in `main.js`, anello di focus
      `:focus-visible`. Corretto anche `Number(v) || 50` in
      `tasting-profile.js`, che trasformava un valore 0 in 50.
    - **D — fogli dal basso**: nuovo `js/sheet-gestures.js` — tocco sullo
      sfondo, maniglia iniettata da JS, trascinamento verso il basso 1:1
      con proiezione della velocità; la chiusura chiama sempre il `.click()`
      del pulsante × esistente, così gira la pulizia di ogni foglio. 7
      fogli coperti; `modal.js` escluso.
    - **E — azioni distruttive**: nuovo `js/toast.js`; "Rimuovi dai
      desideri" mostra "Rimosso dai desideri · Annulla" (l'annulla ricrea
      la voce via `POST /api/cellars/:id/wishlist`: la voce torna in cima
      con un id nuovo); "Seguito" chiede conferma prima di smettere di
      seguire.
    - Audit su 12 schermate, prima → dopo: testo <11px 96 → 0; contrasto
      sotto soglia 116 → 10 (solo stelle spente, che passano la soglia
      3:1 delle icone); controlli <28pt 68 → 10 (link testuali con
      `::after` che la misura non vede); controlli non semantici 118 → 0.
      Test di integrazione Playwright sul codice unito (scheda attiva,
      stappa+annulla, tocco sullo sfondo, Invio da tastiera, toast,
      conferma) tutti verdi, zero `pageerror`.
    - **Da verificare su iPhone vero**: sensazione del trascinamento dei
      fogli (momentum, conflitto con lo scroll), stato `:active` su iOS,
      VoiceOver reale. `CACHE` a `v84`, `build 84`.
20. **Chiusura dell'audit HIG: i quattro punti rimasti.** Fase 1 con tre
    agenti in parallelo, fase 2 da sola sopra il risultato (riscrive tutte
    le dimensioni del testo, sarebbe andata in conflitto con tutto).
    - **Selettore unico**: "Le tue note / Dalla community" (`.rev-tabs`)
      ha ora gli stessi valori di `.segmented` (pillola bianca su grigio).
    - **Righe Cantina**: matita e cestino non sono più sempre visibili:
      compaiono scorrendo la riga verso sinistra (`.cellar-item` avvolge
      riga + `.swipe-actions`; gesto in `wireSwipe()` in `cellar.js`,
      disattivato in modalità Confronta). Per VoiceOver/tastiera le azioni
      restano nel DOM e aprono la riga quando ricevono il focus.
      "Modifica vino" / "Elimina dalla cantina" anche nella scheda del
      vino (`editBottle()`/`deleteBottle()` esportate da `cellar.js`).
    - **Menu in basso**: Esplora come scheda e "+" nelle intestazioni —
      **superato dal punto 21**. Resta valido il pulsante Indietro di
      Aggiungi con `history.state.calDepth` (>0 → `history.back()`,
      apertura diretta → `#/cellar`) e la mappa `HASH_FOR_VIEW`.
    - **Dynamic Type**: il testo segue l'impostazione Dimensioni testo
      dell'iPhone. `html` usa `font: -apple-system-body` (solo WebKit,
      dentro `@supports`; altrove resta 17px), tutte le dimensioni del
      testo sono `calc(Nrem/17)` — esatto: a dimensione predefinita il
      rendering è identico al pixel (23 schermate su 24 byte-identiche,
      l'unica differenza è un overflow di 2px dei chip eliminato). Uno
      script inline in `<head>` di `index.html` limita la base fra 17px e
      34px (200%): sotto non scende per rispettare il minimo di 11px,
      sopra i layout non sono garantiti. Restano in px, apposta: menu in
      basso (come nelle app native), iniziali negli avatar, etichette
      degli slot, badge dei filtri, stelle. I campi dei form sono
      `max(16px, …)` (sotto 16px iOS zooma al focus). Verificato a 135% e
      200%: niente overflow orizzontale, niente testo tagliato.
    - Audit a dimensione predefinita invariato rispetto al punto 19 (testo
      <11px 0, controlli senza ruolo/nome 0; i 15 casi di contrasto sono
      tutti stelle vuote, sopra la soglia 3:1 per le icone). Test di
      integrazione: 11/11. `CACHE` a `v85`, `build 85`.
    - **Nota sui worktree degli agenti**: due agenti della fase 1 sono
      partiti da `2f1a523` (il `master` di allora) invece che dalla punta
      del branch di lavoro. Da allora ogni prompt per un agente in
      worktree comincia con `git reset --hard <commit>` esplicito.
    - **Da provare su iPhone vero**: scorrimento delle righe Cantina
      (convivenza con lo scroll verticale), Dimensioni testo fino al
      massimo (la base deve fermarsi a 34px) anche cambiandola con l'app
      in background, VoiceOver sulle azioni nascoste delle righe.

21. **"+" al centro del menu (scelta dell'utente su mockup).** Tela con
    quattro varianti (com'era / "+" centrale in rilievo / "+" centrale
    piatto con etichetta / "+" centrale con scelta rapida): scelta la
    **B**. Menu: Home · Cantina · **(+)** · Statistiche · Profilo. Il "+" è
    un `.navbtn.nav-add` con `data-view="view-add"` (si accende da solo su
    Aggiungi) e dentro un cerchio bordeaux da 60px (`.nav-add-circle`) che
    sporge 21px sopra il bordo del menu con margine negativo: l'altezza del
    menu resta 49pt. Nessuna etichetta visibile, `aria-label="Aggiungi
    vino"`. Tolti i "+" dalle intestazioni di Home e Cantina. Esplora torna
    sotto-sezione della Home (`TAB_FOR_VIEW` → Home) con il suo pulsante
    Indietro ripristinato.
    - **Effetto collaterale corretto**: il toast "Annulla" era posizionato
      sull'altezza del menu, e il suo bordo inferiore cadeva 9px sotto la
      cima del cerchio: i due si sovrapponevano. `toast.js` ora misura il punto più alto del menu,
      cerchio compreso. Regola in `CLAUDE.md`.
    - Verificato con Playwright: ogni voce del menu, tocco sulla parte
      sporgente del cerchio, Indietro da Aggiungi ed Esplora, 320px senza
      overflow; test di integrazione 11/11 e audit invariati.
      `CACHE` a `v86`, `build 86`.

22. **Ricerca vini sul web: prima Vivino, poi Tavily.** Segnalazione
    utente con screenshot su "ambrosini batud": tutti i vini Ambrosini in
    lista, un titolo con "| Vivino Português (Brasil)" e la stessa foto
    (sbagliata) su ogni riga, mentre la ricerca di vivino.com/IT/it era
    corretta.
    - Nuovo `worker/src/lib/vivino-search.ts`: interroga l'indice di
      ricerca di Vivino (Algolia, chiave pubblica del loro frontend).
      `buildSuggestion()` lo usa per primo sulle ricerche per nome; se
      fallisce o non trova nulla, si passa a Tavily. **Non verificato dal
      vivo**: da questo ambiente vivino.com, algolia.net e api.tavily.com
      sono bloccati dalla policy di rete. App id, chiave e nome dell'indice
      sono quelli noti del frontend di Vivino ma vanno confermati dopo il
      deploy con `GET /api/wines/recognize/debug?q=ambrosini` (da browser,
      dopo il login): `ok:true` e `hitCount>0` = funziona; altrimenti
      `status`/`error` dicono cosa correggere in `VIVINO_ALGOLIA`. Finché
      non funziona, l'app usa Tavily come prima, ma con i filtri corretti.
    - Riserva Tavily: filtro su tutte le parole (con 3+ parole ne può
      mancare una), parole doppie contate una volta, parole generiche
      ignorate (tenuta, cantina, DOCG, IGT…), suffisso "| Vivino …" tolto
      per intero, niente immagini.
    - **Confermato dall'utente in produzione**: `/debug?q=ambrosini` dà
      `ok:true`, e la ricerca restituisce il Batudè con la sua foto.
    - **Campi precompilati** (build 87): ogni candidato Vivino porta
      `prefill` (nome del vino senza cantina, produttore, paese in italiano
      dal codice ISO via `Intl.DisplayNames`, tipo mappato sui 4 dell'app,
      denominazione = la "region" di Vivino, vitigni se il record li ha).
      In `add.js`, `completeFromAtlas()` cerca la denominazione fra i vini
      dell'atlante di Esplora: se la trova aggiunge regione amministrativa
      (Franciacorta → Lombardia), livello ("Franciacorta DOCG") e vitigno
      **solo se l'atlante ne elenca uno** (Barolo → Nebbiolo; sui blend
      l'atlante dice cosa permette il disciplinare, non cosa c'è in quella
      bottiglia, quindi non si indovina). I candidati Tavily, senza
      `prefill`, si comportano come prima.
    - Foto nel foglio "Rivedi e conferma" ridotta: max 180px d'altezza,
      centrata (prima occupava tutta la larghezza).
    - Il debug ora mostra anche `firstHit`, il record grezzo di Vivino:
      utile per scoprire altri campi da precompilare (es. annata, vitigni).
    - Test: 140 verdi. `CACHE` a `v87`, `build 87`.
    - **Build 88**: sul telefono la foto restava a tutta altezza pur con i
      campi già precompilati — cioè `add.js` nuovo ma `index.html` (dove
      stava il `max-height`) vecchio in cache. La dimensione ora la imposta
      `sizeReviewPhoto()` in `add.js`. Regola generale: uno stile da cui
      dipende una funzione JS nuova va messo dove arriva insieme a quel JS,
      non solo nell'HTML.

23. **Note di degustazione: falliva il salvataggio in produzione.** Causa:
    la migrazione `0006_tasting_profile.sql` non era mai stata applicata
    al D1 remoto (fermo alla 0005), mentre il codice inseriva le colonne
    del profilo di gusto. Il payload inviato dall'app era corretto
    (verificato con Playwright). Applicata a mano con lo strumento
    Cloudflare D1 e registrata in `d1_migrations`; nessun dato toccato
    (le note in produzione erano 0). Il deploy non applica le migrazioni:
    regola in `CLAUDE.md`. Poi, su richiesta dell'utente, il workflow
    di deploy applica le migrazioni da solo prima del deploy
    (`migrations_dir` aggiunto al `wrangler.jsonc` di radice).
    Primo run: errore 7403 (il token non aveva D1:Edit). L'utente ha
    aggiunto il permesso; verificato con un deploy ("No migrations to
    apply!") e il passo è tornato bloccante.

24. **Note: stelle leggibili e conferma del salvataggio** (build 89).
    Le stelle vuote ora sono un contorno e quelle scelte un pieno dorato
    (prima `#8e8779` contro `#8a6a1a`, indistinguibili sul telefono). Nella
    scheda del vino "Salva nota" si disattiva durante l'invio, mostra il
    toast "Nota salvata" e, se fallisce, un avviso (prima falliva in
    silenzio). Motivo: senza riscontro l'utente aveva premuto più volte e
    in produzione c'erano 7 note di prova sulla bottiglia 10 (id 2–8, 15/10
    sera, nessun testo reale): cancellate su richiesta dell'utente.

25. **"Salva nota" ripetuto aggiorna invece di duplicare** (build 90,
    richiesta utente). Nuovo `PATCH /api/bottles/:bottleId/notes/:noteId`
    (solo l'autore, solo su quella bottiglia; overwrite completo di tutti i
    campi, validazione condivisa con il POST in `validateNote()`). Nella
    scheda del vino il primo tocco crea la nota, il modulo resta compilato,
    il pulsante diventa "Aggiorna nota" e i tocchi successivi aggiornano la
    stessa nota ("Nota aggiornata"). Riaprendo la scheda il compositore
    riparte vuoto per una nota nuova (prima non veniva mai azzerato fra una
    bottiglia e l'altra). Test: 141 verdi.

26. **Nota scritta durante l'aggiunta di un vino: testata end-to-end**
    (build 91). Test con il Worker vero in locale (`wrangler dev --local`
    con D1 migrato) e la sola ricerca Vivino simulata: la nota del foglio
    "Rivedi e conferma" si salva con testo, stelle, aromi, abbinamenti e
    cursori, compare nella scheda del vino, e il compositore riparte vuoto.
    Due difetti trovati e corretti in `add.js`:
    - la quantità veniva chiesta **dopo** aver creato il vino: "Annulla"
      lasciava un vino orfano nel catalogo condiviso (poi visibile in ogni
      ricerca) e la nota spariva. Ora la quantità si chiede prima; con
      "Annulla" il foglio resta aperto con modulo e nota intatti;
    - "Salva" non si disattivava: un secondo tocco durante la creazione del
      vino lo avrebbe creato due volte. Ora resta disattivato per tutto il
      salvataggio (verificato rallentando la richiesta di proposito).
    - Il catalogo duplicato emerso qui è chiuso al punto 27.
    - Nota tecnica: `pkill -f "wrangler dev"` (e simili) uccide anche la
      shell che lo lancia, perché il suo testo contiene lo stesso pattern.

27. **Catalogo senza doppioni + foto della bottiglia intera** (build 92).
    - `POST /api/wines` riusa il vino esistente con stesso nome +
      produttore + annata (maiuscole e spazi ai bordi ignorati, annata
      nulla = annata nulla) invece di crearne uno nuovo. Del vino
      esistente si riempiono **solo i campi vuoti** (regione, codice a
      barre, uve, denominazione, foto) — mai sovrascritto, perché è
      condiviso e qualcuno può averlo corretto. In produzione non c'erano
      doppioni da ripulire (verificato con una query prima del cambio).
      Le **bottiglie** restano righe separate: aggiungere due volte lo
      stesso vino alla stessa cantina dà due righe (possono avere
      posizioni diverse) — non unificate di proposito.
    - Scheda del vino: la foto da Vivino è un ritaglio di bottiglia alto
      e stretto; con `background-size:cover` sull'intestazione larga se
      ne vedeva solo un ingrandimento del vetro, mai l'etichetta. Con
      `image_url` l'intestazione prende la classe `.has-product`:
      bottiglia intera a destra su fondo chiaro, testo scuro a sinistra,
      niente velatura. Senza foto resta il gradiente per tipo di prima.
    - Build 93: stesso problema nelle miniature (lista Cantina, scatole,
      risultati di ricerca): le `<img>` di foto prodotto hanno la classe
      `product` e `object-fit:contain` (bottiglia intera), mentre le foto
      senza `product` restano `cover`.

28. **Profilo di degustazione completo + popup simmetrico** (build 94).
    - Aromi in 8 famiglie sul lessico WSET/AIS (Frutta, Floreale,
      Vegetale, Spezie, Legno, Lieviti, Evoluto, Minerale; 102 voci, ex
      "Altro" ripartito), abbinamenti da 10 a 30. Le etichette sono salvate
      come testo nelle note: **mai rinominarne una già usata** (spostarla
      di famiglia è innocuo), e nessuna etichetta ripetuta fra famiglie.
      `MAX_TAGS` del server alzato a 40.
    - Cursori da 4 a 7: aggiunti Alcol, Intensità, Persistenza (colonne
      `taste_alcohol/intensity/finish`, migrazione 0007, applicata dal
      deploy). `readTastingProfile`/`isTastingProfileEmpty` ora girano su
      `TASTE_AXES`: un nuovo asse = una voce lì + colonna + `notes.ts` +
      i due payload in `detail.js`/`add.js`.
    - Toast senza azione (es. "Nota salvata"): padding uguale ai due lati
      (classe `has-action` in `toast.js`); prima teneva 6px a destra per il
      pulsante assente.

29. **Ruota degli aromi** (build 95, `#/aromi`, `screens/aromas.js`).
    Scelta dall'utente su mockup: direzione B (mezza ruota delle 8 famiglie
    che gira col dito o con le frecce, scheda famiglia sotto con origine,
    descrizione, tutti gli aromi e vini tipici; tocco su un aroma = scheda
    dell'aroma sopra) + "Il mio palato" della C (ruota completa con uno
    spicchio per aroma lungo quanto spesso compare nelle **proprie** note,
    da `GET /api/me/palate`, che conta ogni aroma una volta per nota).
    - Il vocabolario è `FLAVOR_CATEGORIES` di `tasting-profile.js`
      (esportato), lo stesso della nota: la ruota non ha una lista propria.
      I testi per famiglia stanno in `js/data/aroma-guide.js`, per `id`.
    - In Home la riga sta sotto "Esplora vini per paese", stesso stile
      `.explore-entry`; le due righe sono avvolte in `.explore-links` (niente
      gap del flex della vista fra le due, bordo unico) e il reveal ora
      punta a `home-explore-links`.
    - Ricaduto ancora nel bug `.hidden` contro `display:flex` di CLAUDE.md:
      `.aroma-pane.hidden{display:none}` serve perché `.aroma-pane` viene
      dopo `.hidden` nel CSS.

30. **Ruota completa + vini per aroma** (build 96). Aromi da 102 a 141 in
    9 famiglie (lessico WSET: litchi, uva, cassis, catrame, cera d'api,
    pietra bagnata, cherosene…) più la famiglia **Difetti** (tappo,
    ossidato, acetico, ridotto, smalto, muffa) per poter segnare una
    bottiglia difettosa. In `aroma-guide.js` i 3 vini fissi per famiglia
    sono stati sostituiti da `TAG_WINES` (aroma → vini tipici, nomi scritti
    sempre uguali perché la schermata raggruppa per nome): la scheda di un
    aroma elenca i suoi vini con gli altri aromi per cui sono noti, la lista
    di famiglia mostra i 6 vini con più aromi di quella famiglia. I difetti
    hanno `TAG_NOTES` (cosa si sente e cosa significa) al posto dei vini.
    Geranio, Medicinale e Anice sono senza vini di proposito: nessun
    esempio da manuale certo, meglio vuoto che inventato.

31. **Filtro per vino nella ruota + Assaggio guidato** (build 97).
    Deciso con l'utente su due mockup: filtri a tendina **Tipo + Vino**
    (Paese scartato, nessun terzo filtro), e la degustazione a passi come
    sezione propria in Home, con qualunque vino, non solo quelli in cantina.
    - `aroma-guide.js` ha ora `WINE_STYLES` (tipo + gusto atteso sui 7 assi
      per i 105 vini di `TAG_WINES`, valori indicativi scritti a mano) e
      `WINE_TYPES`. `js/wine-expectation.js` è il modulo comune a ruota e
      assaggio: aromi attesi, gusto atteso (tannino 0 = non pertinente →
      `null`), opzioni dei menu, scheda "Cosa aspettarti".
    - Ruota: scelto un vino, gira sulla famiglia con più suoi aromi, ogni
      spicchio ha un numero (aromi del vino lì dentro), quelli a zero si
      spengono; in alto la scheda "Cosa aspettarti" (il pulsante verso
      l'assaggio è stato tolto in build 98; `#/assaggio?vino=<nome>` funziona
      ancora come rotta).
    - Assaggio guidato (`screens/tasting.js`, `#/assaggio`): scelta vino +
      etichetta facoltativa → Naso (aromi attesi tratteggiati + "Senti
      altro?") → Bocca (cursori con il segno dell'atteso; un cursore non
      toccato resta grigio e **non viene salvato**, così l'atteso non
      diventa la risposta) → Giudizio → Riepilogo (atteso contro sentito)
      → salva. Storico nella stessa schermata, riapribile ed eliminabile.
    - Server: tabella `tastings` (migrazione 0008), `routes/tastings.ts`
      (GET/POST/DELETE, solo i propri), stessa validazione delle note
      (`validateNote` esportata da `notes.ts`). `/api/me/palate` conta anche
      gli assaggi.

32. **Aromi in bocca + ruota più pulita** (build 98).
    - L'utente pensava "al naso i fiori, in bocca il frutto": non è così
      (al naso si riconoscono tutti gli aromi; in bocca dolce/acido/amaro/
      salato e tatto, più gli aromi che risalgono per via retronasale).
      Aggiunto quindi nel passo Bocca "Aromi in bocca" (aromi sentiti al
      naso + attesi), salvati a parte in `tastings.mouth_tags` (migrazione
      0009); il riepilogo dice per ognuno "al naso e in bocca / solo al naso /
      solo in bocca". Il palato conta un aroma una volta per assaggio anche
      se segnato in entrambi.
    - Ruota con un vino filtrato: niente "Dove lo trovi" né "Vini in cui si
      trova" (mostravano altri vini, fuori contesto) e niente pulsante
      "Assaggio guidato" (ridondante con la sezione in Home, chiesto
      dall'utente). Senza filtro restano come prima.
    - Build 99: con un vino filtrato sparisce anche la scheda della famiglia
      (ripeteva gli aromi già elencati in "Cosa aspettarti"); la ruota
      evidenzia invece il gruppo della famiglia puntata dentro "Cosa
      aspettarti" (`currentFamily` in `expectationHtml`).
    - Build 100, deciso con l'utente: con un vino filtrato la **ruota
      sparisce** (con le frecce e la riga d'aiuto; classe `.filtered` sul
      pannello) e resta solo "Cosa aspettarti"; tolti i numeri sugli spicchi
      e `currentFamily`. Gli aromi lì sono etichette non toccabili; quelli
      già presenti nelle proprie note/assaggi hanno un puntino, con
      "N su M già nelle tue note" accanto al titolo (`mine` da
      `/api/me/palate`). Tornando a "Tutti i vini" la ruota ricompare.

33. **Cursori di gusto a scatti 1-10** (build 101). Richiesta dell'utente:
    "troppo liberi". Tutti i cursori (nota di degustazione in scheda vino e
    foglio di aggiunta, Assaggio guidato) si fermano su 10 valori e mostrano
    il numero nel cursore; tastiera ±1. **Il salvataggio resta 0-100**
    (valore = scatto × 10, quindi 5 = 50 = metà, come prima): niente
    migrazione, e le note vecchie si mostrano sullo scatto più vicino.
    Helper `TASTE_STEPS`/`toStep`/`fromStep`/`stepLeft` in
    `tasting-profile.js`; anche il gusto atteso dei vini (`expectedTaste`)
    viene arrotondato agli scatti, così segno atteso, etichette e
    riepilogo parlano dello stesso valore che si può scegliere.

34. **Icone dei momenti nell'Assaggio guidato** (build 102). Scelte
    dall'utente su mockup (6 famiglie): **naso = profilo di viso con i
    profumi** (famiglia C), **bocca = labbra** (famiglia A), giudizio =
    stella. La barra sottile dei passi è diventata tre riquadri con icona
    (`STEP_UI` + `stepperHtml()` in `tasting.js`): quello attuale in
    evidenza, quelli già fatti colorati e toccabili per tornarci; in cima a
    ogni passo un riquadro con l'icona e cosa fare (`stepIntroHtml()`).
    Scartata la "zona della lingua": la mappa dei gusti sulla lingua è un
    mito; proposta una mappa delle sensazioni tattili, ma l'utente ha
    chiesto di toglierla — non riproporla.

35. **Slot occupato negli elementi della cantina** (build 103). Scelta
    dell'utente su mockup: direzione B (scheda sotto il livello, con una
    freccia verso lo slot) + vista **Elenco** della C. Al posto del vecchio
    popup scuro (`#bottle-popup`, rimosso con il suo CSS):
    - slot vuoti tratteggiati, pieni nel colore del tipo (aggiunto il
      rosato), legenda sotto la griglia;
    - scheda con foto, quantità, posizione e quattro azioni: **Apri**,
      **Stappa** (stesse regole della scheda vino: −1 con Annulla, l'ultima
      chiede conferma e rimuove il vino, liberando lo slot), **Sposta** (gli
      slot liberi pulsano, si tocca la destinazione; banner con Annulla),
      **Libera** (subito, con Annulla nel toast). In modalità "scegli dove
      riporla" resta anche "Sostituisci con …";
    - Griglia/Elenco: l'elenco mostra una riga per bottiglia con posizione;
      toccandola si aprono solo le azioni (la riga mostra già il resto).
    Stato in `cellar.js`: `slotSel`, `movingBottle`, `elemView`, azzerati
    tornando all'elenco degli elementi o chiudendo il foglio.

36. **La tua nota è il modulo stesso** (build 104). Su richiesta
    dell'utente: aprendo la scheda di una bottiglia, se hai già una nota il
    modulo si apre compilato con quella (testo, stelle, aromi, abbinamenti,
    cursori; `setTastingProfile()` in `tasting-profile.js`, la famiglia del
    primo aroma scelto è quella aperta) e il pulsante è "Aggiorna nota": una
    nota per persona e bottiglia, modificata sul posto. Sotto non si ripete
    più; eventuali note proprie più vecchie (di prima della modifica sul
    posto) restano visibili come "Note precedenti".
    Pulizia DB fatta su richiesta: cancellata la nota id 9 (bottiglia 10,
    15/10, scritta prima delle modifiche), resta la id 10.

37. **Campi uniformi** (build 105). Su richiesta dell'utente (la nota aveva
    un rettangolo di focus squadrato e scuro, diverso dal resto): tutti gli
    input, le textarea e i menu hanno ora lo stesso stile, definito una volta
    in fondo ad `app.css` (blocco "Campi"): fondo bianco, bordo sottile,
    raggio 12px, Archivo ≥16px, segnaposto `#736a5d`, focus = bordo bordeaux
    con alone, freccia dell'app nei `select`. La textarea della nota è un
    campo con bordo dentro la card. Regola aggiunta in CLAUDE.md.

38. **Messaggi, focus della nota, campo visibile** (build 106).
    - `showToast`: 2,5 s per le conferme semplici, 5 s se c'è "Annulla"
      (si può ancora passare `duration`).
    - La textarea della nota non prendeva il bordo bordeaux al focus:
      `.add-note textarea` ha la stessa specificità di `textarea:focus` e
      veniva dopo. Aggiunto `.add-note textarea:focus` con lo stesso aspetto
      di tutti gli altri campi.
    - Toccando un campo, `main.js` lo porta al centro della parte visibile
      del suo contenitore che scorre (`revealField()`), una volta per focus,
      dopo che la tastiera si è aperta (evento `resize` di visualViewport) o
      dopo 450 ms senza tastiera; se il campo è già tutto visibile non si
      muove niente. Provato in Chromium, **non** con la tastiera iOS vera.

39. **"Modifica vino" senza nota** (build 107). Il foglio condiviso
    `#recognize-overlay` in modalità `edit` nasconde ora la sezione nota
    (`#rec-note-section`, classe `.hidden`) e non salva più note: la nota
    vive nella scheda della bottiglia, che ha già il suo modulo (punto 36).
    In "Rivedi e conferma" (aggiunta di un vino nuovo) la sezione resta.

40. **Costo zero** (build 108). L'utente non vuole pagare mai nulla.
    - **Tavily tolto**: codice (`tavily-search.ts` e test), avviso mensile
      sui crediti in `cron.ts`, secret `TAVILY_API_KEY` dal tipo `Env`,
      tabella `tavily_usage` (migrazione 0010). Uso reale prima della
      rimozione: 68 crediti a settembre, 6 a ottobre, su 1.000 gratuiti.
      Effetti: ricerca per nome solo Vivino (se Vivino non risponde resta il
      nome digitato); il codice a barre non cerca più sul web dopo Open Food
      Facts, apre il foglio con il solo codice. Il secret `TAVILY_API_KEY`
      resta su Cloudflare finché l'utente non lo cancella (innocuo).
    - **Tetto Workers AI**: massimo `OCR_DAILY_LIMIT` = 50 letture di
      etichetta al giorno (tabella `ai_usage`); oltre, avviso e foglio da
      compilare a mano.
    - La sezione di CLAUDE.md sui filtri Tavily è stata sostituita da
      "Costo zero".
41. **Aggiungi: foglio dal "+" con mirino** (build 109). L'utente trovava
    piatta l'interazione del "+"; su tre mockup dinamici ha scelto "B con
    mirino C".
    - **Non è più una schermata**: `#view-add` è sparita, il "+" apre il
      foglio `#add-overlay` sopra la schermata corrente (`openAddSheet()` in
      `add.js`), col campo già a fuoco (focus sincrono dentro il tocco, se no
      iOS non alza la tastiera). `#/add` resta come deep link: porta in Home
      col foglio aperto. Tolti il tasto indietro e il conteggio della
      cronologia (`calDepth`) che servivano solo lì.
    - **A campo vuoto**: Etichetta / Codice a barre, "Cercati di recente"
      (`localStorage`, solo su questo telefono, salvati quando una ricerca
      porta a un'aggiunta), "Dalla tua cantina" con **+1** (PATCH quantità,
      messaggio con Annulla), "Aggiungilo a mano".
    - **Risultati in tre gruppi**: Nella tua cantina (filtrata in locale,
      parole in qualsiasi ordine, accenti ignorati, con +1), Catalogo (esclusi
      i vini già mostrati sopra), Da Vivino (scheletro, poi risultati dopo
      600 ms). Guardia di staleness dopo ogni `await`.
    - **Aggiunta**: niente più alert "Aggiunto alla cantina": il foglio si
      chiude, messaggio breve, e la schermata sotto si ridisegna (si rilancia
      la sua rotta). Nota e foto del "Rivedi e conferma" vengono salvate
      prima della chiusura.
    - **Mirino** (`#camera-overlay`, sopra tutto): cornice ad angoli (larga e
      bassa per il codice), modalità Etichetta / Codice / Scrivi ("Scrivi"
      torna al foglio con la tastiera). Dopo lo scatto l'immagine si ferma,
      gli angoli diventano oro e la linea scorre durante la lettura; poi una
      scheda con Riprova / Conferma (o "Aggiungi alla cantina" se il codice è
      già in catalogo, "Compila a mano" se non si trova niente o il tetto
      OCR è raggiunto). Il flusso video resta acceso fino alla chiusura, così
      Riprova è immediato; `camSession` scarta risposte di scatti vecchi.
    - Provato in locale con worker vero, Vivino/OCR simulati e fotocamera
      finta di Chromium; da verificare su iPhone: tastiera all'apertura,
      permesso fotocamera, lettura dei codici col polyfill.

42. **Menu a metà schermo dopo un'aggiunta** (build 110). Segnalato con
    screenshot dopo aver aggiunto uno Zamuner: l'override di `.screen` per la
    tastiera era rimasto attivo a tastiera chiusa. Corretto in `modal.js`
    (il campo perde il fuoco alla chiusura) e in `main.js` (campo "vivo" solo
    se visibile e fuori dai fogli chiusi, blur automatico alla chiusura di
    ogni foglio, ricalcolo su `focusout`/`pageshow`/`visibilitychange`).
    Dettagli in CLAUDE.md. Non riproducibile in Chromium (niente tastiera
    virtuale): provato simulando l'altezza bloccata, che ora si ripristina
    da sola; da confermare su iPhone.
    Nella stessa sessione, su richiesta, il catalogo `wines` di produzione è
    stato ripulito: restano solo i due vini aggiunti questa settimana (id 34,
    35, in cantina); cancellati 33 vini di prova/vecchie ricerche e le 6
    voci di attività collegate.

43. **Risultati che si aprono nella riga** (build 111). L'utente trovava
    poco intuitivo che il "+" su un vino di Vivino aprisse un altro foglio;
    su tre mockup (aggiunta immediata / apertura nella riga / scheda
    anteprima) ha scelto la B.
    - Catalogo e Vivino hanno la stessa riga, con freccia: toccandola si
      apre un pannello (`pickPanelHtml()` in `add.js`) con i dati che
      verranno salvati (tipo, zona, uve; da Vivino + atlante), l'annata
      (campo solo se il vino non ne ha una), le bottiglie con −/+, il tasto
      "Aggiungi alla cantina" e "Modifica tutti i dati" (il foglio lungo).
      Una sola riga aperta per volta; lo stato (`expanded`) sopravvive al
      ridisegno quando arrivano i risultati di Vivino.
    - Per Vivino il vino si crea con `POST /api/wines` (che deduplica) e poi
      la bottiglia; niente più finestra "Quante bottiglie?" dai risultati
      (resta per il codice a barre e per il foglio lungo).
    - I vini già in cantina o nel catalogo spariscono da "Da Vivino"
      (confronto su produttore + nome, accenti ignorati).
    - `.screen` non deve mai scorrere: scrivendo mentre il foglio sale, il
      browser la spostava di 91px per mostrare il cursore e il titolo del
      foglio finiva fuori schermo. Ora `main.js` la riporta a zero.

44. **Ricerca nel catalogo senza accenti** (build 112, migrazione 0011).
    `LIKE` di SQLite ignora maiuscole solo in ASCII e mai gli accenti
    ("saten" non trovava "Satèn"). Nuova colonna `wines.search_text`: nome,
    produttore, regione, denominazione e uve piegati in JS (`foldSearch()` in
    `wines.ts`: senza accenti, minuscolo, apostrofi tipografici dritti). Ogni
    scrittura del vino la rimette a NULL e `GET /api/wines/search` ricalcola le
    righe NULL prima di cercare, così nessun percorso di scrittura può
    dimenticarla. La ricerca ora vuole tutte le parole in qualsiasi ordine
    ("bosco saten") e tratta `%`/`_` digitati come caratteri normali. Il filtro
    "Nella tua cantina" in `add.js` piega allo stesso modo. Annata minima nel
    pannello allineata al server (1900).

45. **Intestazione della scheda vino "scheda prodotto"** (build 113-114).
    Il nome finiva sopra la foto (sfondo dell'intestazione allineato a
    destra); corretto in 113, poi su richiesta "più stile Apple" tre mockup
    (copertina sfocata / scheda prodotto / immersiva, più una variante della
    C sul Batudè): scelta la **B**, stile App Store. Niente fascia colorata:
    miniatura arrotondata con ombra (`.hero-art`, 104×140) e accanto nome
    grande, produttore · regione, etichette (tipo, denominazione, annata,
    ★ voto medio, che sostituisce il vecchio `badge-score`). Le foto
    dell'etichetta riempiono la miniatura; le bottiglie scontornate di Vivino
    (larghezza/altezza < 0,5, misurata al caricamento) ci stanno intere
    (`.cutout`). La X sta in `.detail-bar`, barra sticky alta 0: quando il nome
    grande esce di vista compare il nome in piccolo su fondo traslucido.

46. **Voto medio di Vivino** (build 115, migrazione 0012). Il prezzo non
    c'è nella risposta dell'indice di Vivino (verificato sul Batudè con
    `/api/wines/recognize/debug`): servirebbe un'altra interfaccia non
    ufficiale, non tentata. C'è invece `statistics` (media su tutte le annate
    e numero di voti; 0 = troppo pochi voti, trattato come assente). Letto in
    `hitToCandidate()` (`rating`), mostrato nella riga che si apre in "Aggiungi
    un vino" ("Vivino ★ 3,8 · 475 voti") e salvato su `wines.vivino_rating` /
    `vivino_ratings_count` (fotografia del momento dell'aggiunta; la coppia è
    validata in `POST /api/wines`). Nella scheda del vino due etichette: "Note
    ★" (media delle note, prima era solo "★") e "Vivino ★". Il Batudè di
    produzione è stato aggiornato a mano con i valori letti (3,8 / 475).
    Altri dati disponibili nella stessa risposta, non usati: voto per annata,
    gradazione, annate esistenti, voto e sito del produttore.

47. **Altri dati certi da Vivino** (build 116, migrazione 0013). Su
    richiesta "solo quello per cui sei certo": classe della denominazione
    ("Franciacorta DOCG"; solo DOCG/DOC/IGT/IGP/AOC/AOP/DOCa/DOQ/DO, mai
    "VDT"), regione amministrativa presa dal produttore **solo** se Vivino vi
    colloca la regione del vino (`parent_id` o stessa regione), gradazione
    (`wines.alcohol`) e sito del produttore (`wines.producer_url`, solo
    http/https), voto della singola annata quando ha abbastanza voti (il
    chip "Vivino" segue l'annata digitata e si salva quello). Nella scheda:
    link al sito sotto produttore · regione, etichetta "12,5% vol".
    `completeFromAtlas()` ignora la classe finale per trovare il vino
    nell'atlante. **Lasciati fuori di proposito**: uve, abbinamenti e stile,
    che Vivino manda solo come codici numerici senza una tabella certa per
    tradurli. Il Batudè di produzione è stato aggiornato a mano (12,5% e
    tenutambrosini.it, dalla risposta di diagnosi).

48. **Dati di Vivino modificabili** (build 117). Nel foglio condiviso
    "Rivedi e conferma" / "Modifica vino" tre campi nuovi dopo la
    denominazione: gradazione (`#rec-alcohol`, virgola o punto), sito del
    produttore (`#rec-site`, `https://` aggiunto se manca) e voto su Vivino
    (`#rec-vivino`, 1-5). Regione e denominazione erano già modificabili.
    Il voto resta quello di Vivino, con il suo numero di voti, finché il
    campo non viene toccato (e in creazione segue l'annata digitata); scritto
    a mano si salva senza numero di voti. Validazione condivisa server-side
    in `readExtras()` (`wines.ts`), usata da POST e PATCH; la PATCH sovrascrive
    anche questi campi (svuotati → NULL), come da regola del progetto.
    Nella stessa sessione, su richiesta, cancellati da produzione tutti i
    vini (cantina e catalogo erano 4: l'utente li reinserisce a mano per
    avere i dati di Vivino); l'arricchimento automatico dei vini esistenti
    era stato iniziato e poi abbandonato, non è nel codice.

49. **Modulo vino con etichette fisse** (build 118). Segnalato dall'utente:
    a campo pieno il placeholder sparisce e "12,5" o "3,8" non dicono cosa
    siano. Due mockup (righe raggruppate stile iOS / etichetta sopra): scelta
    la **B**. Nel foglio "Rivedi e conferma" / "Modifica vino" ogni campo è
    un `.form-field` con `<label>` vero; tre gruppi `.form-sec` (Vino,
    Origine, Da Vivino); coppie in `.form-pair` (tipo+annata,
    gradazione+voto) che vanno a capo da sole col testo grande (griglia
    `auto-fit` con minimo in rem). I placeholder sono solo esempi ("es.
    2019", "Facoltativo"). Unità dentro il campo con `.affix-field` ("% vol",
    ★), stesso aspetto e focus del blocco "Campi". Il sito si mostra senza
    `https://` e senza `/` finale; salvando torna identico.

50. **Desideri dalla ricerca** (build 119). Prima non c'era modo di
    aggiungere ai desideri (solo rimuovere). Su due mockup (pulsante nella
    lista Desideri / dalla ricerca) l'utente ha scelto **solo la 2**: nella
    riga aperta di "Aggiungi un vino" c'è "♡ Metti nei desideri", che porta
    il pannello in modalità desideri (`expanded.mode = 'wish'`): annata se
    serve, prezzo obiettivo facoltativo, "Aggiungi ai desideri", "Aggiungi
    alla cantina invece". Il foglio resta aperto e la riga mostra "♡ nei
    desideri" (anche riaprendolo: `loadWishlist()` all'apertura). `ensureWine()`
    crea il vino Vivino come per la cantina. Server: `POST
    /api/cellars/:id/wishlist` ora valida vino e prezzo e non duplica (lo
    stesso vino aggiorna il prezzo obiettivo). Lista Desideri: annata nel
    nome e "Obiettivo 45,50 €". **Non fatti** (non scelti): pulsante nella
    lista Desideri e "L'ho preso" per spostare in cantina.

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

- Verifiche su iPhone vero elencate ai punti 19 e 20 (gesti, Dimensioni
  testo, VoiceOver): sono l'unica parte dell'audit HIG non coperta da
  Playwright.

- Ampliare la copertura regionale nei paesi con mappa (oggi solo un
  sottoinsieme di regioni/stati ha dati curati).
- Cercare una fonte per i confini di Portogallo/Argentina/Cile (es. un
  file GeoJSON/TopoJSON esterno, non solo pacchetti npm).
- Valutare se aprire una vera PR invece di push diretti su `master`.
- Se il deploy manuale diventa scomodo, si può passare a un trigger
  automatico su push a `master` nello stesso workflow (attualmente
  `workflow_dispatch` di proposito, per non deployare a ogni commit).
