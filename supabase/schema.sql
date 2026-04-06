-- Supabase remote schema for drone motor diagnostics app.
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI migration) to
-- create the remote tables and storage bucket before enabling sync.
--
-- Local SQLite is the source of truth for runs. This schema mirrors the
-- metadata needed for remote search, dashboards, and cross-device access.
-- Raw WAV files are never uploaded. Processed artifacts go to Storage.

-- ── diagnostic_runs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_runs (
  test_id              TEXT        PRIMARY KEY,
  drone_id             TEXT        NOT NULL,
  motor_label          TEXT        NOT NULL,
  run_mode             TEXT        NOT NULL CHECK (run_mode IN ('full_sequence', 'single_motor')),
  recorded_at          TIMESTAMPTZ NOT NULL,
  completed_at         TIMESTAMPTZ,
  microphone_name      TEXT        NOT NULL DEFAULT '',
  overall_status       TEXT        CHECK (overall_status IN ('READY TO FLY', 'WARNING', 'DO NOT FLY')),
  final_classification TEXT,
  sync_status          TEXT        NOT NULL DEFAULT 'synced',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for per-drone history queries
CREATE INDEX IF NOT EXISTS idx_diagnostic_runs_drone_id
  ON diagnostic_runs (drone_id, recorded_at DESC);

-- ── Row-level security (shared app auth — first release) ─────────────────

ALTER TABLE diagnostic_runs ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to insert and read
-- (adjust to per-user policies when multi-tenant auth is added)
CREATE POLICY "allow_all_authenticated"
  ON diagnostic_runs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Storage bucket ───────────────────────────────────────────────────────
-- Create this bucket in the Supabase dashboard or via CLI:
--
--   supabase storage create diagnostic-artifacts --public=false
--
-- Objects are stored at:
--   runs/<test_id>/waveform.png
--   runs/<test_id>/psd.png
--   runs/<test_id>/preprocessed_signal.npz
--   runs/<test_id>/fft_data.npz
--   runs/<test_id>/result.json
--
-- Raw WAV is intentionally excluded from uploads.

-- ── updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_diagnostic_runs_updated_at
  BEFORE UPDATE ON diagnostic_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
