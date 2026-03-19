-- Add retry backoff columns to articles table
ALTER TABLE articles ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN last_retry_at TEXT;
