-- Guided tastings (Assaggio guidato): a tasting of a wine style that need not
-- be in any cellar, so it can't be a tasting_notes row (those hang off a
-- bottle). Same note fields; `style` is the wheel's wine (e.g. 'Barolo'),
-- `label` the optional bottle the user names ("Barolo Cannubi 2019 Brezza").
CREATE TABLE tastings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  style TEXT NOT NULL,
  label TEXT,
  rating REAL NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  flavor_tags TEXT,
  taste_acidity INTEGER,
  taste_sweetness INTEGER,
  taste_tannin INTEGER,
  taste_body INTEGER,
  taste_alcohol INTEGER,
  taste_intensity INTEGER,
  taste_finish INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tastings_user ON tastings(user_id, created_at);
