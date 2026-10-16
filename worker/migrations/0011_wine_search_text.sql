-- Accent-free, lowercase copy of a wine's searchable fields, so the catalog
-- search finds "Satèn" from "saten". Filled by the Worker (routes/wines.ts):
-- every write sets it back to NULL and the search refills NULL rows first.
ALTER TABLE wines ADD COLUMN search_text TEXT;
