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

1. **Feature "Esplora vini per paese"** — nuova voce in Home → mappa
   dell'Italia (confini reali da `@svg-maps/italy`, CC BY 4.0) con 20
   regioni, dropdown di selezione, card dettaglio (vini/uve/categorie)
   per le 10 regioni con dati curati; le altre mostrano "dati in arrivo".
   Dato statico in `public/js/data/italy-regions.js`, schermata in
   `public/js/screens/explore.js`, route `#/esplora`. Nessuna modifica
   backend (contenuto editoriale, non dati utente).
2. **Deploy da remoto senza credenziali locali** — aggiunto il workflow
   GitHub Actions manuale sopra, per poter deployare da telefono/browser
   quando non c'è accesso a un terminale.
3. **Bug PWA iOS (status bar / viewport)** — vedi `CLAUDE.md` per la
   cronologia completa. Stato finale: `status-bar-style: default`
   (male minore, già scelto in passato), e in `main.js` la chiamata
   eager di `applyViewportHeight()` al load è stata rimossa (causava
   una zona grigia al cold-launch da icona Home).

## Cose note, non (ancora) da rifare

- La barra di stato grigia in alto, in modalità PWA da Home Screen, **non
  è un bug** — è il compromesso già scelto rispetto a `black-translucent`
  (che sta peggio). Non ritentare senza leggere `CLAUDE.md` prima.
- La mappa Italia in Esplora copre solo 10/20 regioni con dati reali
  (vini/uve/categorie); le altre 10 sono placeholder "in arrivo" —
  scelta deliberata per non inventare dati non verificati.
- Il selettore paese nella sheet "Cambia" mostra solo l'Italia come
  attiva; gli altri paesi sono voci mute "presto disponibile", nessuna
  mappa dietro per ora.

## Prossimi passi possibili (non richiesti, solo spunti)

- Coprire le altre 10 regioni italiane in Esplora, se serve.
- Valutare se aprire una vera PR invece di push diretti su `master`.
- Se il deploy manuale diventa scomodo, si può passare a un trigger
  automatico su push a `master` nello stesso workflow (attualmente
  `workflow_dispatch` di proposito, per non deployare a ogni commit).
