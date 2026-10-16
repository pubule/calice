-- From Vivino when the wine is added from a Vivino result: the alcohol
-- content (% vol) and the producer's website.
ALTER TABLE wines ADD COLUMN alcohol REAL;
ALTER TABLE wines ADD COLUMN producer_url TEXT;
