# Tab "Sentori e note": lettura e modulo a sotto-tab — design

Data: 2026-10-19. Mockup approvati dall'utente:
`https://claude.ai/artifact/FfHwZLHvToTjYSUDDrMJbL` (riga "Tab Sentori e
note", variante **S2**, e riga "S2 · Modifica la nota": lettura vuota,
lettura con voto e testo, modifica Aromi, modifica Gusto).

## Perché

Nel tab "Sentori e note" della scheda vino il modulo della nota è una colonna
unica: testo, stelle, 9 card di famiglie, fino a 42 badge di una famiglia in
fila, 7 cursori, 30 abbinamenti. L'utente "si perde" a cercare in mezzo ai
badge gli aromi scelti e il gusto. Le card delle famiglie piacciono e restano;
sono i badge sparsi il problema. Inoltre il tab serve soprattutto a
**rileggere** com'era il vino, e oggi la lettura è mescolata alla scrittura.

## Obiettivi

1. Il tab mostra la nota **da leggere**: solo ciò che c'è.
2. Il modulo si apre a parte ("Modifica la nota") ed è diviso in sotto-tab,
   così aromi, gusto, abbinamenti e testo non stanno mai tutti insieme.
3. Gli aromi scelti sono sempre visibili in un punto solo.
4. Un cursore del gusto non toccato è "non segnato" e non compare nella nota.
5. Lo stesso modulo ovunque si scrive una nota (scelta dell'utente).

## Non obiettivi

- L'Assaggio guidato (`screens/tasting.js`) resta com'è: ha la sua interfaccia
  a passi e non monta il modulo condiviso. Il suo ultimo passo apre già il
  foglio del "+" con la nota, e lì comparirà il modulo nuovo.
- La Ruota degli aromi (`screens/aromas.js`) e `wine-expectation.js` non
  cambiano.
- Nessun aroma rinominato: le etichette sono salvate come testo nelle note
  (`flavor_tags`), vedi il commento in testa a `tasting-profile.js`.
- Nessuna modifica al backend: `notes.ts` accetta già `null` per ogni asse.

## Anti-obiettivi (sarebbe un fallimento anche se funziona)

- Un dato vuoto che si vede comunque ("Abbinamenti: nessuno", cursore a 5).
- Un aroma scelto che non si vede senza aprire la sua famiglia.
- Due implementazioni del modulo che divergono (detail.js vs add.js).
- Perdere quanto scritto chiudendo il foglio per errore.

## Cosa si vede: lettura (tab "Sentori e note")

Una card "La tua nota", con la data della nota a destra del titolo. Sotto, in
quest'ordine, **ogni parte solo se ha un valore**:

1. Voto: stelle bordeaux (mezza stella per i decimali, come `setMyStars`) e
   il numero (`4,5`). Nascosto se il voto è 0.
2. Testo: serif (Newsreader), più grande del corpo, come una citazione.
3. Aromi: una riga per famiglia che ha aromi scelti, nell'ordine di
   `FLAVOR_CATEGORIES`: icona della famiglia nel suo riquadro colorato,
   nome della famiglia, aromi separati da virgola.
4. Gusto: solo gli assi segnati. Riga: nome dell'asse, barra 1-10, etichetta
   del lato (es. "Strutturato"; "equilibrato" a 5-6, stessa soglia di
   `positionThumb`).
5. Abbinamenti: elenco separato da virgola.

In fondo alla card il pulsante pieno **Modifica la nota**. Senza nessuna nota
dell'utente al posto della card c'è solo il pulsante **Scrivi una nota**.
Le note precedenti (`#notes-mine`) restano sotto, come oggi.

## Cosa si vede: modifica

Un foglio dal basso (stesso comportamento degli altri fogli: maniglia,
trascinamento e tocco sullo sfondo da `sheet-gestures.js`), alto quasi tutto
lo schermo. In cima: **Annulla** · "La tua nota" · **Salva** (pieno).
Sotto: le stelle grandi con il numero toccabile per i decimali (comportamento
attuale di `#note-rating-value`). Poi i sotto-tab, con a fianco il conteggio
di quanto è segnato quando > 0: **Aromi 2 · Gusto 1 · Cibo · Testo**.

- **Aromi**: riga "Scelti:" con un pulsante per aroma (colori della famiglia,
  `×`, tocco = lo toglie). Sotto, le card delle famiglie come oggi, ognuna con
  un pallino contatore se ha aromi scelti. Un campo "Cerca un aroma…" che
  filtra su **tutte** le famiglie. Sotto, i badge della famiglia attiva; gli
  scelti restano al loro posto ma evidenziati. **Frutta** (42 aromi) è divisa
  in gruppetti con intestazione: Frutti rossi e neri, Agrumi, Frutta bianca e
  gialla, Tropicale, Secca e cotta (la suddivisione esatta di ogni aroma la
  decide il builder; ogni aroma in un solo gruppo). Le altre famiglie restano
  un blocco unico.
- **Gusto**: 7 righe (ordine di `TASTE_AXES`). Non toccata: traccia
  tratteggiata con "non segnato · tocca". Il primo tocco mette il valore nel
  punto toccato; poi si trascina come oggi (1-10, tastiera e VoiceOver come
  oggi). In fondo "Azzera il gusto" riporta tutte le righe a non segnato.
- **Cibo**: i badge degli abbinamenti di oggi.
- **Testo**: l'area di testo della nota.

**Salva** salva voto, testo, aromi, gusto e abbinamenti con una sola chiamata
(oggi le stelle salvano subito con `PUT /my-rating`: nel foglio diventano
parte del salvataggio unico; nella card di lettura le stelle non sono
toccabili — approvato dall'utente con il resto della specifica), chiude il foglio, ridisegna la card, aggiorna i
numeri in alto e la lista della Cantina (`refreshCellarList`). **Annulla**,
il tocco sullo sfondo e il trascinamento chiudono senza salvare; se qualcosa è
cambiato chiedono prima conferma (`confirmModal`, "Scartare le modifiche?").

## Dati

- Un asse non toccato vale `null` in `readTastingProfile()`; resettato e
  "Azzera" lo riportano a `null`. `isTastingProfileEmpty()` considera vuoto un
  profilo con tutti gli assi `null`.
- `setTastingProfile()` carica `null` come non segnato e ogni altro numero
  come segnato. **Nessuna conversione dei 5 esistenti**: verificato il
  2026-10-19 che in produzione nessuna nota ha un asse a 50 e i desideri non
  hanno note; un 5 scelto d'ora in poi resta un 5. (Decisione dell'utente:
  "tratta tutto come non segnato"; con zero dati da convertire coincide con
  questo.)
- `tasteSummary`, l'export CSV di Profilo e `cellar.js` gestiscono già `null`.

## Dove si usa (tutti con lo stesso componente)

- Scheda vino, tab "Sentori e note" (`detail.js`): lettura + foglio di
  modifica.
- Foglio "Rivedi e conferma" / Modifica vino (`add.js`, `#recognize-taste`):
  il modulo compare inline con gli stessi sotto-tab Aromi · Gusto · Cibo ·
  Testo; voto e salvataggio restano quelli del foglio ospite.
- Nota passata dall'Assaggio guidato a `openAddSheet({ tasting })`: arriva
  precompilata nel modulo nuovo.

Il modulo (`tasting-profile.js`) possiede quindi anche il campo di testo: gli
ospiti tolgono il proprio. Le stelle restano dell'ospite.

## Vincoli

- Minimi HIG del progetto (CLAUDE.md "Minimi HIG"): testo ≥ 11px, aree di
  tocco ≥ 44pt, ruoli e nomi per VoiceOver, `:focus-visible`.
- Selettori sempre scoped al proprio contenitore: il modulo è montato due
  volte nella pagina (CLAUDE.md "Selettori DOM globali").
- Nascondere con la classe `.hidden`, mai l'attributo `hidden` (CLAUDE.md).
- Campi di testo `max(16px, …)` (zoom di iOS).
- `CACHE` in `sw.js` e `build NN` in `index.html` alzati insieme; HANDOFF.md
  aggiornato prima del push.

## Lasciato al builder

Struttura interna dei file, nomi di classi e funzioni, la suddivisione esatta
di Frutta in gruppetti, animazioni (rispettando `prefers-reduced-motion`),
i test e2e da aggiornare o aggiungere.
