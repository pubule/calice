-- Where vivino_rating comes from when it is not Vivino (null = Vivino): a
-- score found on another site for a wine Vivino does not rate (user's
-- choice, 2026-10-20), shown with that site's name.
ALTER TABLE wines ADD COLUMN rating_source TEXT;
