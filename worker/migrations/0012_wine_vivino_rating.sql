-- Vivino's community rating for the wine (all vintages together), saved when
-- the wine is added from a Vivino result: average 1-5 and number of ratings.
-- A snapshot of that moment, shown next to the user's own score.
ALTER TABLE wines ADD COLUMN vivino_rating REAL;
ALTER TABLE wines ADD COLUMN vivino_ratings_count INTEGER;
