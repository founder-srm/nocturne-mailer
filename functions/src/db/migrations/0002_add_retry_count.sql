-- Add retry_count to emails table for retry/DLQ logic
ALTER TABLE emails ADD COLUMN retry_count INTEGER DEFAULT 0;

-- Optional: index to query dead letters quickly
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
