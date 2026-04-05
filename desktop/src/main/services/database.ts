/**
 * DatabaseService — wraps better-sqlite3 for all local persistence.
 *
 * Responsibilities:
 *   - schema migrations
 *   - CRUD for drone_profiles, throttle_presets, baseline_profiles,
 *     diagnostic_runs, upload_jobs
 *   - upload queue management
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type {
  BaselineProfile,
  DiagnosticRun,
  DroneProfile,
  SyncStatus,
  ThrottlePreset,
  UploadJob,
} from "../../shared/types";

export class DatabaseService {
  private db!: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
  }

  close(): void {
    if (this.db?.open) {
      this.db.close();
    }
  }

  // ── Migrations ─────────────────────────────────────────────────────────

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
        (r) => r.version
      )
    );

    const migrations: [number, string][] = [[1, MIGRATION_001]];

    for (const [version, sql] of migrations) {
      if (!applied.has(version)) {
        this.db.exec(sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(version, new Date().toISOString());
      }
    }
  }

  // ── Drone profiles ─────────────────────────────────────────────────────

  getDroneProfiles(): DroneProfile[] {
    return this.db
      .prepare("SELECT * FROM drone_profiles ORDER BY display_name")
      .all() as DroneProfile[];
  }

  createDroneProfile(droneId: string, displayName: string, notes = ""): DroneProfile {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO drone_profiles (drone_id, display_name, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(droneId, displayName, notes, now, now);
    return this.db
      .prepare("SELECT * FROM drone_profiles WHERE id = ?")
      .get(info.lastInsertRowid) as DroneProfile;
  }

  // ── Throttle presets ───────────────────────────────────────────────────

  getThrottlePresets(): ThrottlePreset[] {
    return this.db
      .prepare("SELECT * FROM throttle_presets ORDER BY throttle_value")
      .all() as ThrottlePreset[];
  }

  createThrottlePreset(
    preset: Omit<ThrottlePreset, "id" | "created_at" | "updated_at">
  ): ThrottlePreset {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO throttle_presets
           (name, throttle_value, duration_ms, cooldown_ms, mic_name, requires_high_throttle_confirm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        preset.name,
        preset.throttle_value,
        preset.duration_ms,
        preset.cooldown_ms,
        preset.mic_name,
        preset.requires_high_throttle_confirm ? 1 : 0,
        now,
        now
      );
    return this.db
      .prepare("SELECT * FROM throttle_presets WHERE id = ?")
      .get(info.lastInsertRowid) as ThrottlePreset;
  }

  // ── Baseline profiles ──────────────────────────────────────────────────

  getBaselineProfiles(droneId: string): BaselineProfile[] {
    return this.db
      .prepare("SELECT * FROM baseline_profiles WHERE drone_id = ? ORDER BY created_at DESC")
      .all(droneId) as BaselineProfile[];
  }

  upsertBaselineProfile(
    profile: Omit<BaselineProfile, "id" | "created_at" | "updated_at">
  ): BaselineProfile {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        "SELECT id FROM baseline_profiles WHERE drone_id = ? AND throttle_preset_id = ?"
      )
      .get(profile.drone_id, profile.throttle_preset_id) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE baseline_profiles SET
             capture_count = ?, baseline_result_path = ?,
             baseline_preprocessed_path = ?, baseline_fft_path = ?,
             baseline_plot_path = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          profile.capture_count,
          profile.baseline_result_path,
          profile.baseline_preprocessed_path,
          profile.baseline_fft_path,
          profile.baseline_plot_path,
          now,
          existing.id
        );
      return this.db
        .prepare("SELECT * FROM baseline_profiles WHERE id = ?")
        .get(existing.id) as BaselineProfile;
    }

    const info = this.db
      .prepare(
        `INSERT INTO baseline_profiles
           (drone_id, throttle_preset_id, capture_count, baseline_result_path,
            baseline_preprocessed_path, baseline_fft_path, baseline_plot_path,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.drone_id,
        profile.throttle_preset_id,
        profile.capture_count,
        profile.baseline_result_path,
        profile.baseline_preprocessed_path,
        profile.baseline_fft_path,
        profile.baseline_plot_path,
        now,
        now
      );
    return this.db
      .prepare("SELECT * FROM baseline_profiles WHERE id = ?")
      .get(info.lastInsertRowid) as BaselineProfile;
  }

  // ── Diagnostic runs ────────────────────────────────────────────────────

  getDiagnosticRuns(limit = 50, offset = 0): DiagnosticRun[] {
    return this.db
      .prepare(
        "SELECT * FROM diagnostic_runs ORDER BY recorded_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as DiagnosticRun[];
  }

  getDiagnosticRun(testId: string): DiagnosticRun | null {
    return (
      (this.db
        .prepare("SELECT * FROM diagnostic_runs WHERE test_id = ?")
        .get(testId) as DiagnosticRun | undefined) ?? null
    );
  }

  insertDiagnosticRun(
    run: Omit<DiagnosticRun, "id" | "created_at" | "updated_at">
  ): DiagnosticRun {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO diagnostic_runs
           (test_id, drone_id, motor_label, run_mode, throttle_preset_id,
            recorded_at, completed_at, microphone_name, overall_status,
            final_classification, results_json_path, raw_wav_path, raw_mp3_path,
            preprocessed_data_path, fft_data_path, waveform_graph_path,
            psd_graph_path, sync_status, retry_count, last_sync_error,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        run.test_id, run.drone_id, run.motor_label, run.run_mode,
        run.throttle_preset_id, run.recorded_at, run.completed_at,
        run.microphone_name, run.overall_status, run.final_classification,
        run.results_json_path, run.raw_wav_path, run.raw_mp3_path,
        run.preprocessed_data_path, run.fft_data_path, run.waveform_graph_path,
        run.psd_graph_path, run.sync_status, run.retry_count,
        run.last_sync_error, now, now
      );
    return this.db
      .prepare("SELECT * FROM diagnostic_runs WHERE id = ?")
      .get(info.lastInsertRowid) as DiagnosticRun;
  }

  updateDiagnosticRun(
    testId: string,
    fields: Partial<
      Pick<
        DiagnosticRun,
        | "completed_at"
        | "overall_status"
        | "final_classification"
        | "results_json_path"
        | "waveform_graph_path"
        | "psd_graph_path"
        | "preprocessed_data_path"
        | "fft_data_path"
        | "sync_status"
        | "retry_count"
        | "last_sync_error"
      >
    >
  ): void {
    const now = new Date().toISOString();
    const sets = Object.entries(fields)
      .map(([k]) => `${k} = ?`)
      .join(", ");
    const values = Object.values(fields);
    this.db
      .prepare(`UPDATE diagnostic_runs SET ${sets}, updated_at = ? WHERE test_id = ?`)
      .run(...values, now, testId);
  }

  // ── Upload queue ───────────────────────────────────────────────────────

  getPendingUploadJobs(): UploadJob[] {
    return this.db
      .prepare(
        `SELECT * FROM upload_jobs
         WHERE status IN ('pending', 'error')
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC`
      )
      .all(new Date().toISOString()) as UploadJob[];
  }

  upsertUploadJob(testId: string, status: SyncStatus = "pending"): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT id FROM upload_jobs WHERE test_id = ?")
      .get(testId);
    if (existing) {
      this.db
        .prepare(
          "UPDATE upload_jobs SET status = ?, updated_at = ? WHERE test_id = ?"
        )
        .run(status, now, testId);
    } else {
      this.db
        .prepare(
          `INSERT INTO upload_jobs (test_id, status, attempt_count, created_at, updated_at)
           VALUES (?, ?, 0, ?, ?)`
        )
        .run(testId, status, now, now);
    }
  }

  markUploadJobError(testId: string, error: string, nextRetryAt: Date): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE upload_jobs
         SET status = 'error', last_error = ?,
             next_retry_at = ?, attempt_count = attempt_count + 1, updated_at = ?
         WHERE test_id = ?`
      )
      .run(error, nextRetryAt.toISOString(), now, testId);
  }

  markUploadJobSynced(testId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE upload_jobs SET status = 'synced', updated_at = ? WHERE test_id = ?"
      )
      .run(now, testId);
    this.updateDiagnosticRun(testId, { sync_status: "synced" });
  }
}

// ── SQL migration 001 ──────────────────────────────────────────────────────

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS drone_profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  drone_id     TEXT    NOT NULL UNIQUE,
  display_name TEXT    NOT NULL,
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS throttle_presets (
  id                             INTEGER PRIMARY KEY AUTOINCREMENT,
  name                           TEXT    NOT NULL,
  throttle_value                 INTEGER NOT NULL,
  duration_ms                    INTEGER NOT NULL,
  cooldown_ms                    INTEGER NOT NULL,
  mic_name                       TEXT    NOT NULL DEFAULT '',
  requires_high_throttle_confirm INTEGER NOT NULL DEFAULT 0,
  created_at                     TEXT    NOT NULL,
  updated_at                     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_profiles (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  drone_id                  TEXT    NOT NULL,
  throttle_preset_id        INTEGER NOT NULL,
  capture_count             INTEGER NOT NULL DEFAULT 0,
  baseline_result_path      TEXT    NOT NULL DEFAULT '',
  baseline_preprocessed_path TEXT   NOT NULL DEFAULT '',
  baseline_fft_path         TEXT    NOT NULL DEFAULT '',
  baseline_plot_path        TEXT    NOT NULL DEFAULT '',
  created_at                TEXT    NOT NULL,
  updated_at                TEXT    NOT NULL,
  FOREIGN KEY (throttle_preset_id) REFERENCES throttle_presets(id)
);

CREATE TABLE IF NOT EXISTS diagnostic_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id               TEXT    NOT NULL UNIQUE,
  drone_id              TEXT    NOT NULL,
  motor_label           TEXT    NOT NULL,
  run_mode              TEXT    NOT NULL,
  throttle_preset_id    INTEGER NOT NULL,
  recorded_at           TEXT    NOT NULL,
  completed_at          TEXT,
  microphone_name       TEXT    NOT NULL DEFAULT '',
  overall_status        TEXT,
  final_classification  TEXT,
  results_json_path     TEXT,
  raw_wav_path          TEXT,
  raw_mp3_path          TEXT,
  preprocessed_data_path TEXT,
  fft_data_path         TEXT,
  waveform_graph_path   TEXT,
  psd_graph_path        TEXT,
  sync_status           TEXT    NOT NULL DEFAULT 'pending',
  retry_count           INTEGER NOT NULL DEFAULT 0,
  last_sync_error       TEXT,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL,
  FOREIGN KEY (throttle_preset_id) REFERENCES throttle_presets(id)
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id       TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error    TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

-- Seed default throttle presets
INSERT OR IGNORE INTO throttle_presets
  (id, name, throttle_value, duration_ms, cooldown_ms, mic_name, requires_high_throttle_confirm, created_at, updated_at)
VALUES
  (1, 'Low (1050)', 1050, 6000, 3000, '', 0, datetime('now'), datetime('now')),
  (2, 'Med (1150)', 1150, 6000, 3000, '', 0, datetime('now'), datetime('now')),
  (3, 'Med-High (1200)', 1200, 6000, 3000, '', 0, datetime('now'), datetime('now')),
  (4, 'High (1300)', 1300, 6000, 5000, '', 1, datetime('now'), datetime('now'));
`;
