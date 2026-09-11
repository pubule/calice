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

## PWA su iOS: status bar / viewport — non ritoccare senza guardare prima la storia

`public/index.html`'s `apple-mobile-web-app-status-bar-style` è su **`default`**
e va lasciato così. È già stato provato `black-translucent` e revertato
(commit `d0d2bd8`, 3 settembre): su questo tema chiaro (sfondo crema),
`black-translucent` forza icone/testo bianchi della status bar tramite uno
scrim scuro, che stona quanto (o più di) `default`'s barra grigio chiara —
e il contenuto è già impaginato sotto `env(safe-area-inset-top)` invece di
disegnare sotto la barra, quindi il vantaggio "immersivo" di
`black-translucent` non serve comunque a nulla qui. Nessuna delle due
opzioni è perfetta: `default` è il male minore già scelto deliberatamente.

Il blocco `visualViewport` in `public/js/main.js` (gestisce il gap da
tastiera in modalità standalone) è stato scritto e testato **solo** in
combinazione con `status-bar-style: default` — con `black-translucent`
(`viewport-fit=cover` edge-to-edge) `visualViewport.height` diverge da
`window.innerHeight` anche a riposo, e quel blocco lascia una fascia nera
non dipinta in fondo allo schermo. Se in futuro serve rivisitare la status
bar, il blocco `visualViewport` va rivisto insieme, non trattato come
indipendente.

**Prima di ritoccare uno dei due**: `git log --oneline -i --grep="status.bar\|viewport\|safe-area\|black-translucent"`
— c'è una lunga serie di tentativi già fatti (vedi commit da `3a8468a` a
`d0d2bd8`) prima di arrivare allo stato attuale. Leggere quelli prima di
riprovare varianti già scartate.

### Bug distinto: zona grigia solo al cold-launch da icona Home

Anche in `status-bar-style: default` (quello giusto, sopra) restava una
zona grigia in alto **solo** al lancio a freddo dall'icona Home, che
spariva da sola aprendo e richiudendo la tastiera. Causa: la chiamata
eager `applyViewportHeight()` al load leggeva `visualViewport.offsetTop`
prima che iOS l'avesse assestato dopo un cold-launch standalone,
fissando `.screen` con un piccolo offset sbagliato (si vedeva lo sfondo
di `body` nel gap). Il primo evento reale `resize`/`scroll` (es. la
tastiera) ricalcolava con valori corretti e il problema spariva — indizio
che ha portato dritti al fix. Rimossa la chiamata eager: `.screen` resta
sui default CSS (`top:0`, `100dvh`, già corretti a riposo) finché non
arriva un vero evento di resize/scroll.
