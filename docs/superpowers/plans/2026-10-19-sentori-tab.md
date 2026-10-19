# Tab "Sentori e note" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il tab "Sentori e note" della scheda vino mostra la nota da leggere (solo i dati presenti) e la modifica in un foglio a sotto-tab Aromi · Gusto · Cibo · Testo, con lo stesso modulo anche nel foglio "Rivedi e conferma".

**Architecture:** Il modulo condiviso `public/js/tasting-profile.js` viene riscritto (sotto-tab, riga "Scelti", contatori, ricerca, gruppetti di Frutta, cursori "non segnato" = `null`, campo testo incluso) mantenendo le stesse funzioni esportate. `add.js` lo ospita inline; `detail.js` sostituisce il compositore nel tab con una card di sola lettura e un nuovo foglio `#note-overlay` che ospita il modulo. Nessuna modifica al backend.

**Tech Stack:** JS vanilla ES modules, CSS in `public/css/app.css`, markup statico in `public/index.html`, test Playwright in `e2e/` (server `wrangler dev` avviato dalla config).

**Spec:** `docs/superpowers/specs/2026-10-19-sentori-tab-design.md`

## Global Constraints

- Nessun aroma rinominato; ogni aroma in una sola famiglia e, per Frutta, in un solo gruppetto.
- Asse del gusto non toccato = `null` (mai 50). Nessuna conversione dei dati esistenti.
- Nascondere con la classe `.hidden`, mai l'attributo nativo `hidden`.
- Selettori sempre scoped al contenitore del modulo (`root.querySelector…`): il modulo è montato due volte nella pagina.
- Minimi HIG: testo ≥ 11px (`calc(Nrem/17)` come il resto del file), aree di tocco ≥ 44px, `role`/`aria-label` sui controlli non nativi, `aria-pressed` sui toggle, `aria-selected` sui sotto-tab.
- Campi di testo: `font-size: max(16px, …)`.
- Copy esatta: sotto-tab "Aromi", "Gusto", "Cibo", "Testo"; "Scelti:"; "Cerca un aroma…"; "non segnato · tocca"; "Azzera il gusto"; "La tua nota"; "Modifica la nota"; "Scrivi una nota"; "Annulla"; "Salva"; "Scartare le modifiche?".
- `CACHE` in `public/sw.js` e `build NN` in `public/index.html` alzati insieme (prossimo: 161).
- Prima del push: `HANDOFF.md` aggiornato (CLAUDE.md, "Handoff: aggiornarlo a ogni push").

## Review Focus

1. Nota con solo voto 0 e testo vuoto ma aromi scelti (la nota vera dell'Amarone): la card mostra solo titolo, data e aromi, nessuna stella.
2. Cursore toccato poi "Azzera il gusto" e Salva: l'API riceve `null` per tutti gli assi, la card non mostra la sezione Gusto.
3. Annulla dopo aver cambiato solo un aroma: compare "Scartare le modifiche?"; annullando la conferma il foglio resta aperto con la modifica.
4. Ricerca "pru": trova Prugna, Prugna secca (Frutta) anche se la famiglia attiva è un'altra; svuotando il campo torna la famiglia attiva.
5. Nota dall'Assaggio guidato con assi `null` e testo, passata a `openAddSheet({ tasting })`: nel foglio "Rivedi e conferma" i cursori sono "non segnato" e il testo è nel sotto-tab Testo.

---

### Task 1: Gruppetti di Frutta

**Files:**
- Modify: `public/js/tasting-profile.js` (voce `frutta` di `FLAVOR_CATEGORIES`)
- Test: `e2e/tasting-profile-data.spec.ts` (nuovo; importa il modulo in Node, nessun browser)

**Interfaces:**
- Produces: la famiglia `frutta` ha in più `groups: { label: string; tags: string[] }[]`; `tags` resta la lista piatta (usata da aromas.js, tasting.js, wine-expectation.js).

- [ ] **Step 1: Scrivere il test**

```ts
import { test, expect } from '@playwright/test';
import { FLAVOR_CATEGORIES } from '../public/js/tasting-profile.js';

test('Frutta: ogni aroma in esattamente un gruppetto', () => {
  const frutta = FLAVOR_CATEGORIES.find((c) => c.id === 'frutta')!;
  expect(frutta.groups.map((g) => g.label)).toEqual(['Frutti rossi e neri', 'Agrumi', 'Frutta bianca e gialla', 'Tropicale', 'Secca e cotta']);
  const grouped = frutta.groups.flatMap((g) => g.tags);
  expect(grouped.length).toBe(frutta.tags.length);
  expect(new Set(grouped)).toEqual(new Set(frutta.tags));
});

test('nessun aroma in due famiglie', () => {
  const all = FLAVOR_CATEGORIES.flatMap((c) => c.tags);
  expect(new Set(all).size).toBe(all.length);
});
```

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `npx playwright test e2e/tasting-profile-data.spec.ts`
Expected: FAIL su `frutta.groups` undefined.

- [ ] **Step 3: Aggiungere `groups` a `frutta`**

Gruppetti (fissati qui, i 42 aromi esistenti):
- Frutti rossi e neri: Fragola, Lampone, Ciliegia, Amarena, Ribes, Frutti di bosco, Mora, Mirtillo, Prugna, Cassis, Ciliegia nera, Mirtillo rosso
- Agrumi: Agrumi, Limone, Pompelmo, Arancia, Lime, Scorza d'arancia
- Frutta bianca e gialla: Mela verde, Mela, Pera, Pesca, Albicocca, Nettarina, Mela cotogna, Uva spina, Uva, Melone
- Tropicale: Ananas, Mango, Frutto della passione, Banana, Litchi
- Secca e cotta: Fico, Uvetta, Frutta cotta, Confettura, Prugna secca, Albicocca secca, Marmellata d'arancia, Kirsch, Dattero

Lasciare `tags` invariata (stesso ordine).

- [ ] **Step 4: Eseguire e vedere passare**

Run: `npx playwright test e2e/tasting-profile-data.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add public/js/tasting-profile.js e2e/tasting-profile-data.spec.ts
git commit -m "Group Frutta aromas into five sub-groups"
```

---

### Task 2: Modulo a sotto-tab, ospitato nel foglio "Rivedi e conferma"

**Files:**
- Modify: `public/js/tasting-profile.js` (`tastingProfileHtml`, `wireTastingProfile`, `resetTastingProfile`, `setTastingProfile`, `readTastingProfile`, `isTastingProfileEmpty`, `sliderValue`, `positionThumb`)
- Modify: `public/js/screens/add.js:1162-1168` (`resetNoteComposer`), `:1293-1330` (`prefillNoteComposer`, `composerNote`)
- Modify: `public/index.html:468` (togliere `#rec-note-text`; il testo ora è nel modulo)
- Modify: `public/css/app.css` (stili del modulo: sotto-tab, riga Scelti, contatore sulle card, ricerca, intestazioni dei gruppetti, traccia tratteggiata)
- Test: `e2e/tasting-profile.spec.ts` (nuovo)

**Interfaces:**
- Consumes: `FLAVOR_CATEGORIES[*].groups` (Task 1, solo Frutta).
- Produces (firme invariate salvo dove indicato):
  - `tastingProfileHtml(): string` — markup con sotto-tab `.tp-tabs` (pulsanti `data-tp-tab="aromi|gusto|cibo|testo"`, ognuno con `<span class="tp-count">` vuoto se 0), pannelli `.tp-panel[data-tp-panel=…]`, riga `.tp-chosen`, `input.tp-search`, card `.flavor-card` con `.tp-badge`, `.flavor-chip-panel` (Frutta con `.tp-group-label` per gruppetto), `.taste-slider` (attributo `data-unset` quando non segnato), pulsante `.tp-reset-taste`, chip abbinamenti in `.chip-row`, `textarea.tp-text` con `aria-label="Nota di degustazione"`.
  - `wireTastingProfile(root: HTMLElement): void`
  - `resetTastingProfile(root): void` — nessun aroma/abbinamento, tutti gli assi non segnati, testo vuoto, sotto-tab "aromi", prima famiglia attiva, ricerca vuota.
  - `setTastingProfile(root, note: { flavor_tags?, food_pairings?, taste_<axis>?: number|null, text?: string }): void` — **nuovo campo `text`**.
  - `readTastingProfile(root): { flavorTags: string[]; foodPairings: string[]; text: string; tasteAcidity…tasteFinish: number|null }` — **nuovo `text`** (trim), assi non segnati = `null`.
  - `isTastingProfileEmpty(profile): boolean` — vero se nessun aroma, nessun abbinamento, testo vuoto, tutti gli assi `null`.

- [ ] **Step 1: Scrivere i test** (`e2e/tasting-profile.spec.ts`)

Aprire il foglio: `page.goto('/')`, `page.route('**/api/wines/recognize', r => r.fulfill({ json: { candidates: [] } }))`, click `.nav-add`, fill `#add-search-input` con `zzz${runId}`, click `[data-manual]`, attendere `#recognize-overlay.open`. Tutti i locator scoped a `const tp = page.locator('#recognize-taste')`.

```ts
test('sotto-tab: un pannello alla volta, parte da Aromi', async () => {
  await expect(tp.locator('.tp-tabs [aria-selected="true"]')).toHaveText(/Aromi/);
  await expect(tp.locator('.tp-panel[data-tp-panel="gusto"]')).toBeHidden();
  await tp.locator('[data-tp-tab="gusto"]').click();
  await expect(tp.locator('.tp-panel[data-tp-panel="gusto"]')).toBeVisible();
  await expect(tp.locator('.tp-panel[data-tp-panel="aromi"]')).toBeHidden();
});

test('aromi scelti: riga Scelti, contatori, × li toglie', async () => {
  await tp.locator('.flavor-chip-panel:not(.hidden) .chip', { hasText: /^Amarena$/ }).click();
  await expect(tp.locator('.tp-chosen')).toContainText('Amarena');
  await expect(tp.locator('.flavor-card[data-cat="frutta"] .tp-badge')).toHaveText('1');
  await expect(tp.locator('[data-tp-tab="aromi"] .tp-count')).toHaveText('1');
  await tp.locator('.tp-chosen button', { hasText: 'Amarena' }).click();
  await expect(tp.locator('.tp-chosen button')).toHaveCount(0);
  await expect(tp.locator('.flavor-card[data-cat="frutta"] .tp-badge')).toHaveText('');
});

test('ricerca su tutte le famiglie', async () => {
  await tp.locator('.flavor-card[data-cat="spezie"]').click();
  await tp.locator('.tp-search').fill('pru');
  await expect(tp.locator('.tp-results .chip')).toHaveText(['Prugna', 'Prugna secca']);
  await tp.locator('.tp-search').fill('');
  await expect(tp.locator('.flavor-chip-panel[data-cat="spezie"]')).toBeVisible();
});

test('Frutta divisa in gruppetti', async () => {
  await expect(tp.locator('.flavor-chip-panel[data-cat="frutta"] .tp-group-label')).toHaveText(['Frutti rossi e neri', 'Agrumi', 'Frutta bianca e gialla', 'Tropicale', 'Secca e cotta']);
});

test('gusto: non segnato finché non si tocca, Azzera lo riporta a null', async ({ page }) => {
  await tp.locator('[data-tp-tab="gusto"]').click();
  const body = tp.locator('.taste-slider[data-axis="body"]');
  await expect(body).toHaveAttribute('data-unset', '');
  await expect(body).toContainText('non segnato · tocca');
  await body.locator('.taste-track').click({ position: { x: 5, y: 10 } }); // lato sinistro → 1
  await expect(body).not.toHaveAttribute('data-unset', '');
  expect(await page.evaluate(async () => {
    const m = await import('/js/tasting-profile.js');
    return m.readTastingProfile(document.getElementById('recognize-taste')).tasteBody;
  })).toBe(10);
  await tp.locator('.tp-reset-taste').click();
  expect(await page.evaluate(async () => {
    const m = await import('/js/tasting-profile.js');
    const p = m.readTastingProfile(document.getElementById('recognize-taste'));
    return [p.tasteBody, m.isTastingProfileEmpty(p)];
  })).toEqual([null, true]);
});

test('salvataggio dal foglio manda testo e assi null', async ({ page }) => {
  // nome/produttore come in add-wine.spec.ts "manual add"; poi:
  await tp.locator('[data-tp-tab="testo"]').click();
  await tp.locator('.tp-text').fill('Nota di prova');
  const req = page.waitForRequest((r) => r.url().includes('/notes') && r.method() === 'POST');
  // click #recognize-save, fillPrompt(page, '1'), dismissAlert(page)
  const body = (await req).postDataJSON();
  expect(body.text).toBe('Nota di prova');
  expect(body.tasteBody).toBeNull();
});
```

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `npx playwright test e2e/tasting-profile.spec.ts`
Expected: FAIL (`.tp-tabs` assente).

- [ ] **Step 3: Riscrivere il modulo in `tasting-profile.js`**

- Il valore di un asse vive in `slider.dataset.value`; non segnato = attributo `data-unset` presente e nessun `data-value`. `sliderValue(slider): number|null`.
- Primo `pointerdown` su una traccia non segnata: toglie `data-unset` e imposta il valore dal punto toccato (stessa formula di oggi); tastiera su traccia non segnata: la prima freccia imposta 5 (`fromStep(5)`).
- `positionThumb` su asse non segnato: nasconde il pollice, mostra il testo "non segnato · tocca", `aria-valuetext="non segnato"`.
- Contatori (`.tp-badge` per famiglia, `.tp-count` per sotto-tab: Aromi = aromi scelti, Gusto = assi segnati, Cibo = abbinamenti, Testo vuoto) ricalcolati da un'unica funzione interna chiamata dopo ogni cambio e da `set/resetTastingProfile`.
- Riga `.tp-chosen`: un `<button type="button">` per aroma scelto, con i colori della sua famiglia (`bg`/`fg`), testo + `×`, `aria-label="Togli <aroma>"`; il click disattiva il chip corrispondente. Nascosta (`.hidden`) se vuota.
- Ricerca: con testo non vuoto nasconde i pannelli di famiglia e mostra `.tp-results` con i chip di tutte le famiglie il cui testo contiene la query (case- e accent-insensitive: `normalize('NFD').replace(/\p{M}/gu,'')`), in ordine di `FLAVOR_CATEGORIES`. I chip dei risultati sono copie con `data-tag` (non hanno `data-toggle`, così `readTastingProfile` non li conta due volte): il click attiva/disattiva il chip originale e aggiorna la copia. Ricerca vuota: torna il pannello della famiglia attiva.
- I chip abbinamenti restano `.chip-row .chip[data-toggle]` (selettore usato da `readTastingProfile`).

- [ ] **Step 4: Adattare `add.js` e `index.html`**

Togliere `<textarea id="rec-note-text">`; in `resetNoteComposer`, `prefillNoteComposer` (passare `text: note.text` a `setTastingProfile`) e `composerNote` (`text = profile?.text ?? ''`) eliminare ogni uso di `#rec-note-text`. `composerNote` invia gli assi così come li dà `readTastingProfile` (anche `null`).

- [ ] **Step 5: Eseguire e vedere passare**

Run: `npx playwright test e2e/tasting-profile.spec.ts e2e/tasting-profile-data.spec.ts`
Expected: tutti passed.

- [ ] **Step 6: Commit**

```bash
git add public/js/tasting-profile.js public/js/screens/add.js public/index.html public/css/app.css e2e/tasting-profile.spec.ts
git commit -m "Tasting profile: sub-tabs, chosen row, search, unset taste axes"
```

---

### Task 3: Tab "Sentori e note": card di lettura e foglio di modifica

**Files:**
- Modify: `public/index.html` (pannello `data-tab-panel="notes"`: sostituire `.add-note` con `<div id="note-card"></div>`; nuovo overlay subito dopo `#detail-overlay`: `<div class="detail-overlay note-overlay" id="note-overlay"><div class="detail-sheet note-sheet" role="dialog" aria-label="La tua nota">` con header `#note-cancel` "Annulla" · titolo "La tua nota" · `#note-save` "Salva", le stelle `.stars-input` e `#note-rating-value` spostate qui, poi `<div class="taste-profile" id="detail-taste"></div>`)
- Modify: `public/js/screens/detail.js` (`myStars` selector, rimuovere `saveMyRating` e il click immediato delle stelle, `resetNoteComposerFn`/`fillNoteComposerFn`, handler di salvataggio, nuove `renderNoteCard`, `openNoteSheet`, `closeNoteSheet`)
- Modify: `public/js/sheet-gestures.js` (`SHEETS` += `['note-overlay', 'note-cancel']`)
- Modify: `public/css/app.css` (`.note-overlay` z-index sopra `.detail-overlay` (20 → 30); card di lettura)
- Test: `e2e/bottle-detail.spec.ts`

**Interfaces:**
- Consumes: `setTastingProfile(root, note)` con `text`, `readTastingProfile(root)` con `text` e assi `null`, `isTastingProfileEmpty` (Task 2); `FLAVOR_CATEGORIES` (icone, `bg`, `fg`, `label`); `TASTE_AXES` (`name`, `left`, `right`, `id`, `key`); `toStep`.
- Produces: `renderNoteCard(note: object|null): void` (riempie `#note-card`), `openNoteSheet(): void`, `closeNoteSheet(): void` — interne a `detail.js`.

- [ ] **Step 1: Scrivere i test** (in `e2e/bottle-detail.spec.ts`, nuovo `test(...)` con vino e bottiglia propri)

```ts
// senza nota
await page.click('#detail-tabs button:has-text("Sentori e note")');
await expect(page.locator('#note-card')).toHaveText(/Scrivi una nota/);
await page.click('#note-card button');
await expect(page.locator('#note-overlay')).toHaveClass(/open/);

// solo aromi, voto 0: la card mostra solo aromi
await page.locator('#detail-taste .flavor-chip-panel:not(.hidden) .chip', { hasText: /^Amarena$/ }).click();
await page.click('#note-save');
await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
const card = page.locator('#note-card');
await expect(card).toContainText('La tua nota');
await expect(card.locator('.nc-aromas')).toContainText('Frutta');
await expect(card.locator('.nc-aromas')).toContainText('Amarena');
await expect(card.locator('.nc-stars, .nc-text, .nc-taste, .nc-pairings')).toHaveCount(0);

// voto 4 e testo
await page.click('#note-card button:has-text("Modifica la nota")');
await page.locator('#note-overlay .stars-input span').nth(3).click();
await page.locator('#detail-taste [data-tp-tab="testo"]').click();
await page.locator('#detail-taste .tp-text').fill('Lungo sul finale');
await page.click('#note-save');
await expect(card.locator('.nc-stars')).toHaveAttribute('aria-label', 'Il tuo voto: 4 su 5');
await expect(card.locator('.nc-text')).toHaveText('Lungo sul finale');
await expect(card.locator('.nc-taste')).toHaveCount(0);

// Annulla con modifiche chiede conferma; annullando la conferma resta aperto
await page.click('#note-card button:has-text("Modifica la nota")');
await page.locator('#detail-taste .tp-chosen button', { hasText: 'Amarena' }).click();
await page.click('#note-cancel');
await expect(page.locator('#app-modal-title')).toHaveText('Scartare le modifiche?');
await cancelModal(page);
await expect(page.locator('#note-overlay')).toHaveClass(/open/);
await page.click('#note-cancel');
await confirmModal(page);
await expect(page.locator('#note-overlay')).not.toHaveClass(/open/);
await expect(card.locator('.nc-aromas')).toContainText('Amarena'); // nulla salvato

// Annulla senza modifiche chiude subito
await page.click('#note-card button:has-text("Modifica la nota")');
await page.click('#note-cancel');
await expect(page.locator('#app-modal-title')).toBeHidden();
```

Aggiornare il test esistente "opens with hero info and accepts a tasting note": scrivere la nota passando da `#note-card button` → sotto-tab Testo → `#note-save`, e verificare `.nc-text`.

- [ ] **Step 2: Eseguire e vedere fallire**

Run: `npx playwright test e2e/bottle-detail.spec.ts -g "Sentori|opens with hero"`
Expected: FAIL (`#note-card` assente).

- [ ] **Step 3: Implementare in `detail.js`, `index.html`, `sheet-gestures.js`, `app.css`**

- `renderNoteCard(note)`: con `note == null` solo `<button>` "Scrivi una nota". Altrimenti titolo "La tua nota", data `toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })`, poi solo se presenti: `.nc-stars` (`role="img"`, `aria-label="Il tuo voto: <ratingText> su 5"`, stelle a riempimento come `setMyStars`) + numero; `.nc-text`; `.nc-aromas` una riga per famiglia in ordine di `FLAVOR_CATEGORIES` (icona nel riquadro `bg`/`fg`, label, aromi uniti da ", "); `.nc-taste` una riga per asse non `null` (nome, barra `toStep(v)*10 %`, etichetta: `left` se `v<40`, `right` se `v>60`, altrimenti "equilibrato"); `.nc-pairings`; infine `<button>` "Modifica la nota". Ogni testo via `textContent`/`escapeHtml` (i dati vengono dall'API).
- `openNoteSheet()`: carica nel modulo la nota corrente (`setTastingProfile(detailTaste, { ...note, text: note?.text })`, `setMyStars(note?.rating)`), salva una fotografia `JSON.stringify([readTastingProfile(detailTaste), myRatingValue])` per il controllo delle modifiche, apre `#note-overlay`.
- `#note-cancel`: se la fotografia è cambiata `await confirmModal('Le modifiche alla nota andranno perse.', { title: 'Scartare le modifiche?' })`; se confermato o nulla è cambiato, `closeNoteSheet()`.
- `#note-save`: stesso corpo e stesse regole del salvataggio di oggi (`rating = myRatingValue || (text ? 3 : 0)`, POST o PATCH su `savedNoteId`, bottone disabilitato durante la chiamata, `alertModal` sull'errore); in più `currentBottle.my_rating = rating || null`, `renderStats(currentBottle)`, `refreshCellarList()`, `closeNoteSheet()`, `renderNoteCard(saved)`, toast come oggi. Niente più `PUT /my-rating` dalle stelle.
- `openDetail`: dopo aver trovato `own`, `renderNoteCard(own ?? null)`; `closeNoteSheet()` all'apertura e alla chiusura della scheda.

- [ ] **Step 4: Eseguire e vedere passare**

Run: `npx playwright test e2e/bottle-detail.spec.ts -g "Sentori|opens with hero"`
Expected: passed.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/screens/detail.js public/js/sheet-gestures.js public/css/app.css e2e/bottle-detail.spec.ts
git commit -m "Sentori tab: read-only note card and tabbed note sheet"
```

---

### Task 4: Nota dall'Assaggio guidato, build, documentazione

**Files:**
- Test: `e2e/tasting-profile.spec.ts` (nuovo test)
- Modify: `public/sw.js` (`calice-shell-v161`), `public/index.html` (`build 161`), `HANDOFF.md` (nuovo punto 77), `CLAUDE.md` (sezione "Profilo di gusto: asse non segnato = null")

**Interfaces:**
- Consumes: `openAddSheet({ query, tasting: { note, mode, done } })` (`add.js:604`), il modulo del Task 2.

- [ ] **Step 1: Scrivere il test**

```ts
test('nota dall\'Assaggio guidato: assi null restano non segnati, testo nel sotto-tab Testo', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { openAddSheet } = await import('/js/screens/add.js');
    openAddSheet({ query: '', tasting: { mode: 'cellar', done: () => {}, note: {
      rating: 4, text: 'Dall\'assaggio', flavorTags: ['Amarena'], foodPairings: [],
      tasteAcidity: null, tasteSweetness: null, tasteTannin: 70, tasteBody: null, tasteAlcohol: null, tasteIntensity: null, tasteFinish: null } } });
  });
  // aprire il foglio completo come nel Task 2 ([data-manual])
  const tp = page.locator('#recognize-taste');
  await tp.locator('[data-tp-tab="gusto"]').click();
  await expect(tp.locator('.taste-slider[data-axis="body"]')).toHaveAttribute('data-unset', '');
  await expect(tp.locator('.taste-slider[data-axis="tannin"]')).not.toHaveAttribute('data-unset', '');
  await tp.locator('[data-tp-tab="testo"]').click();
  await expect(tp.locator('.tp-text')).toHaveValue('Dall\'assaggio');
});
```

- [ ] **Step 2: Eseguire**

Run: `npx playwright test e2e/tasting-profile.spec.ts -g "Assaggio"`
Expected: PASS se i Task 2-3 sono corretti; se fallisce, correggere `prefillNoteComposer` in `add.js` (deve passare `text` e gli assi così come sono).

- [ ] **Step 3: Build e documentazione**

Alzare `CACHE`/`build` a 161. `HANDOFF.md` punto 77: cosa cambia per l'utente, file toccati, "asse non segnato = null, nessuna conversione: 0 note a 50 in produzione al 2026-10-19", Assaggio guidato e Ruota invariati. `CLAUDE.md`: breve sezione con la regola `null` = non segnato (mai 50) e che il modulo possiede il campo testo (gli ospiti non ne aggiungono un altro).

- [ ] **Step 4: Suite completa**

Run: `npx playwright test e2e/tasting-profile-data.spec.ts e2e/tasting-profile.spec.ts e2e/bottle-detail.spec.ts`
Expected: tutto passed tranne "deleting a bottle…" (rotto da prima del build 158, vedi HANDOFF "Cose note").

- [ ] **Step 5: Commit**

```bash
git add public/sw.js public/index.html HANDOFF.md CLAUDE.md e2e/tasting-profile.spec.ts
git commit -m "Build 161: tabbed tasting note everywhere; docs"
```

Push e deploy (`gh workflow run deploy.yml --ref master`) solo dopo l'ok dell'utente.
