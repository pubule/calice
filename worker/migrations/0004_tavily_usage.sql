CREATE TABLE tavily_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credits INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
