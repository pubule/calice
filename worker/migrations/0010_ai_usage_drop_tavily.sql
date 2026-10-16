-- Tavily (paid web search) was removed: its credit log goes too.
DROP TABLE IF EXISTS tavily_usage;
-- Daily count of label photos read by Workers AI, capped in recognize.ts so
-- the app stays inside the free allocation.
CREATE TABLE ai_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);
