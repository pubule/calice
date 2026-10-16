-- A photo of vineyards for each area (denomination, region or country) from
-- Wikimedia Commons, shown behind the bottle in the detail sheet. One row per
-- search term; file null = nothing usable found (searched again after a while).
CREATE TABLE landscapes (
  term TEXT PRIMARY KEY,
  file TEXT,
  url TEXT,
  page_url TEXT,
  author TEXT,
  license TEXT,
  license_url TEXT,
  checked_at TEXT NOT NULL
);
