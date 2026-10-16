-- When a classic-method sparkling wine was disgorged (YYYY-MM), from its
-- label: the best guide to when to drink it. Per bottle row, since lots of
-- the same wine are disgorged at different times.
ALTER TABLE bottles ADD COLUMN disgorged_at TEXT;
