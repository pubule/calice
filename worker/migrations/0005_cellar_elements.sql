CREATE TABLE cellar_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  tiers INTEGER,
  cols INTEGER,
  depth INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cellar_elements_cellar ON cellar_elements(cellar_id);

ALTER TABLE bottles ADD COLUMN element_id INTEGER REFERENCES cellar_elements(id);
ALTER TABLE bottles ADD COLUMN slot_tier INTEGER;
ALTER TABLE bottles ADD COLUMN slot_col INTEGER;
ALTER TABLE bottles ADD COLUMN slot_depth INTEGER;
