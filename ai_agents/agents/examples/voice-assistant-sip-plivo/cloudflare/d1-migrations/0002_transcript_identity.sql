ALTER TABLE transcripts ADD COLUMN sequence INTEGER;
ALTER TABLE transcripts ADD COLUMN source_timestamp_ms INTEGER;
ALTER TABLE transcripts ADD COLUMN turn_id INTEGER;
ALTER TABLE transcripts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_idempotency
  ON transcripts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transcripts_call_sequence
  ON transcripts(call_id, sequence);
