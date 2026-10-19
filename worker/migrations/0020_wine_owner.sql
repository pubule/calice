-- Each user has their own wines (the user's choice, 2026-10-19): editing a
-- wine, its photo or its vintage never changes another user's cellar. What
-- stays shared is the search when adding a wine (all users' wines, one per
-- name + producer + vintage, the most complete one), and adding one makes
-- the user's own copy (worker/src/lib/wine-owner.ts).
-- Owner: the first user who has it in a cellar, else in a wishlist, else
-- whoever created it. On 2026-10-19 no wine in production was in the cellars
-- of two users, so none needed splitting.
ALTER TABLE wines ADD COLUMN owner_id INTEGER REFERENCES users(id);
UPDATE wines SET owner_id = coalesce(
  (select cellar_members.user_id from bottles join cellar_members on cellar_members.cellar_id = bottles.cellar_id
    where bottles.wine_id = wines.id order by bottles.id limit 1),
  (select cellar_members.user_id from wishlist_items join cellar_members on cellar_members.cellar_id = wishlist_items.cellar_id
    where wishlist_items.wine_id = wines.id order by wishlist_items.id limit 1),
  created_by
);
CREATE INDEX idx_wines_owner ON wines(owner_id);
