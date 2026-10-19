-- When the user last saved a backup from Profilo ("Scarica backup").
ALTER TABLE users ADD COLUMN last_backup_at TEXT;
