CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cellars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cellar_members (
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (cellar_id, user_id)
);

CREATE TABLE cellar_invites (
  code TEXT PRIMARY KEY,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  producer TEXT NOT NULL,
  region TEXT,
  country TEXT NOT NULL,
  type TEXT NOT NULL,
  vintage INTEGER,
  barcode TEXT,
  source TEXT NOT NULL DEFAULT 'custom',
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_wines_barcode ON wines(barcode);
CREATE INDEX idx_wines_name ON wines(name);

CREATE TABLE bottles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_paid REAL,
  shelf_location TEXT,
  drink_from TEXT,
  drink_until TEXT,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bottles_cellar ON bottles(cellar_id);

CREATE TABLE wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  target_price REAL,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating REAL NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bottle_id INTEGER NOT NULL REFERENCES bottles(id),
  r2_key TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  followee_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE activity_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cellar_id INTEGER NOT NULL REFERENCES cellars(id),
  wine_id INTEGER NOT NULL REFERENCES wines(id),
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
