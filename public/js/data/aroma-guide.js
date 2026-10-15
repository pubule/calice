// What the aroma wheel (#/aromi) says about each family of the tasting-note
// vocabulary (FLAVOR_CATEGORIES in tasting-profile.js, keyed by its id). The
// aromas themselves are not repeated here: the wheel reads them from the
// same list the note composer uses, so the two can never disagree.
// `wines` pairs a wine or grape with aromas of this family it is known for —
// textbook examples, not data about the user's cellar.
export const AROMA_GUIDE = {
  frutta: {
    origin: "Primario · dall'uva",
    desc: "Il cuore di ogni vino giovane. Nei rossi frutti rossi e neri; nei bianchi mela, pera, agrumi e frutta tropicale. Con l'età vira verso confettura e frutta cotta.",
    wines: [['Pinot Nero', 'fragola, lampone'], ['Sauvignon Blanc', 'pompelmo, frutto della passione'], ['Amarone', 'amarena, uvetta, frutta cotta']],
  },
  floreale: {
    origin: "Primario · dall'uva",
    desc: "Più netto nei vini giovani e nei vitigni aromatici; si affievolisce con l'invecchiamento.",
    wines: [['Nebbiolo', 'rosa, violetta'], ["Moscato d'Asti", 'zagara, sambuco'], ['Gewürztraminer', 'rosa, gelsomino']],
  },
  vegetale: {
    origin: "Primario · dall'uva",
    desc: 'Note verdi ed erbe aromatiche, legate a vitigni come Sauvignon e Cabernet o a uve raccolte non del tutto mature.',
    wines: [['Sauvignon Blanc', 'bosso, foglia di pomodoro'], ['Cabernet Franc', 'peperone verde'], ['Vermentino', 'macchia mediterranea, salvia']],
  },
  spezie: {
    origin: 'Primario o dal legno',
    desc: "Il pepe viene dall'uva (Syrah, Grüner Veltliner); vaniglia, chiodi di garofano e cannella arrivano spesso dalla botte.",
    wines: [['Syrah', 'pepe nero'], ['Grüner Veltliner', 'pepe bianco'], ['Rioja Reserva', 'vaniglia, chiodi di garofano']],
  },
  legno: {
    origin: 'Secondario · dalla botte',
    desc: 'Il rovere, soprattutto nuovo e tostato, cede vaniglia, cocco, tostature e cacao. Più la botte è piccola e nuova, più si sente.',
    wines: [['Chardonnay in barrique', 'tostato, vaniglia'], ['Rioja', 'cocco, cedro'], ['Brunello di Montalcino', 'legno, cacao']],
  },
  lieviti: {
    origin: 'Secondario · dalla fermentazione',
    desc: 'Dalla sosta sui lieviti e dalla fermentazione malolattica. È il linguaggio del metodo classico: più mesi sui lieviti, più crosta di pane e brioche.',
    wines: [['Franciacorta', 'crosta di pane, brioche'], ['Champagne', 'biscotto, pasticceria'], ['Chardonnay con malolattica', 'burro, panna']],
  },
  evoluto: {
    origin: "Terziario · dall'invecchiamento",
    desc: 'Arriva con gli anni in bottiglia: il frutto si ritira e lascia spazio a cuoio, sottobosco, frutta secca e miele.',
    wines: [['Barolo maturo', 'cuoio, tabacco, tartufo'], ['Marsala', 'noce, mandorla, caramello'], ['Sauternes', 'miele, marzapane']],
  },
  minerale: {
    origin: 'Dal suolo e dallo stile',
    desc: 'Sensazioni di pietra, sale e fumo. Da dove vengano si discute ancora, ma sono tipiche di certi suoli e vitigni.',
    wines: [['Chablis', 'gesso, pietra focaia'], ['Riesling maturo', 'idrocarburi'], ['Etna Bianco', 'salino, pietra focaia']],
  },
};
