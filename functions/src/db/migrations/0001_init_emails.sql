-- Create emails table used by the queue processor and API
-- This schema matches the fields accessed in src/db/config.ts

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Index to speed up lookups for queued jobs
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);

-- Optional: If you frequently select by created_at, you can enable this index.
-- CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at);
