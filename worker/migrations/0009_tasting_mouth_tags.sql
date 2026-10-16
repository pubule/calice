-- Aromas found again in the mouth (retronasal) during a guided tasting,
-- alongside flavor_tags (the nose). JSON array of the same aroma labels.
ALTER TABLE tastings ADD COLUMN mouth_tags TEXT;
