-- Where each bottle of a wine sits: one row per physical bottle placed in an
-- element (slot coordinates null for a box). A wine with 3 bottles can have
-- up to 3 places. Replaces bottles.element_id/slot_* (one place for all the
-- bottles of a wine, which made it impossible to put two in two slots);
-- those columns stay but are no longer read or written.
CREATE TABLE bottle_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  element_id INTEGER NOT NULL REFERENCES cellar_elements(id),
  slot_tier INTEGER,
  slot_col INTEGER,
  slot_depth INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bottle_places_bottle ON bottle_places(bottle_id);
CREATE INDEX idx_bottle_places_element ON bottle_places(element_id);

INSERT INTO bottle_places (bottle_id, element_id, slot_tier, slot_col, slot_depth)
  SELECT id, element_id, slot_tier, slot_col, slot_depth FROM bottles WHERE element_id IS NOT NULL;
