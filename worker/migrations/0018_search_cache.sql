-- Answers of the name search on Vivino (and Wikidata's grapes), shared by
-- every user: the same words typed again are answered from here.
CREATE TABLE search_cache (
  term TEXT PRIMARY KEY,
  suggestion TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
