-- A guided tasting can end in the wishlist: its note (same shape as a
-- tasting note body, JSON) waits here until the wine is moved to the cellar.
ALTER TABLE wishlist_items ADD COLUMN note TEXT;
