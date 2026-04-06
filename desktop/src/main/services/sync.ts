/**
 * SyncService — background worker that uploads completed runs to Supabase.
 *
 * Behaviour:
 *   - polls the upload_jobs queue every SYNC_INTERVAL_MS
 *   - uploads metadata to Supabase Postgres and artifacts to Supabase Storage
 *   - marks jobs as synced on success
 *   - retries failures with exponential backoff (max MAX_RETRY_DELAY_MS)
 *   - never uploads raw WAV files by default
 *   - emits "sync:status-change" IPC events to the renderer window
 */
import fs from "fs";
import { BrowserWindow } from "electron";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { DatabaseService } from "./database";
import type { DiagnosticRun } from "../../shared/types";

const SYNC_INTERVAL_MS = 30_000;      // 30 seconds
const BASE_RETRY_DELAY_MS = 5_000;    // 5 s
const MAX_RETRY_DELAY_MS = 300_000;   // 5 min

export class SyncService {
  private db: DatabaseService;
  private supabase: SupabaseClient | null = null;
  private timer: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  configure(supabaseUrl: string, anonKey: string): void {
    if (supabaseUrl && anonKey) {
      this.supabase = createClient(supabaseUrl, anonKey);
    } else {
      this.supabase = null;
    }
  }

  setWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  startBackgroundSync(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.syncPending(); }, SYNC_INTERVAL_MS);
  }

  stopBackgroundSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Enqueue a test run for upload and immediately notify the renderer.
   * Called by the analysis IPC handler after a successful run.
   */
  enqueue(testId: string): void {
    this.db.upsertUploadJob(testId);
    this.emitSyncStatus(testId, "pending");
  }

  /**
   * Process all pending/errored upload jobs. Called on each timer tick.
   * Can also be called directly to trigger an immediate sync attempt.
   */
  async syncPending(): Promise<void> {
    if (!this.supabase) return;

    const jobs = this.db.getPendingUploadJobs();
    for (const job of jobs) {
      // Mark as syncing
      this.db.updateDiagnosticRun(job.test_id, { sync_status: "syncing" });
      this.emitSyncStatus(job.test_id, "syncing");

      try {
        const run = this.db.getDiagnosticRun(job.test_id);
        if (!run) {
          this.db.markUploadJobSynced(job.test_id);
          continue;
        }

        await this.uploadRun(run);
        this.db.markUploadJobSynced(job.test_id);
        this.emitSyncStatus(job.test_id, "synced");
      } catch (err) {
        const retryDelay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, job.attempt_count),
          MAX_RETRY_DELAY_MS,
        );
        this.db.markUploadJobError(
          job.test_id,
          err instanceof Error ? err.message : String(err),
          new Date(Date.now() + retryDelay),
        );
        this.db.updateDiagnosticRun(job.test_id, { sync_status: "error" });
        this.emitSyncStatus(job.test_id, "error");
      }
    }
  }

  private emitSyncStatus(testId: string, status: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("sync:status-change", { testId, status });
    }
  }

  private async uploadRun(run: DiagnosticRun): Promise<void> {
    if (!this.supabase) throw new Error("Supabase not configured");

    // 1. Upload artifacts to Supabase Storage (skip raw WAV)
    const artifactsToUpload: [string | null, string][] = [
      [run.waveform_graph_path, "waveform.png"],
      [run.psd_graph_path, "psd.png"],
      [run.preprocessed_data_path, "preprocessed_signal.npz"],
      [run.fft_data_path, "fft_data.npz"],
      [run.results_json_path, "result.json"],
    ];

    for (const [localPath, remoteName] of artifactsToUpload) {
      if (localPath && fs.existsSync(localPath)) {
        const fileBuffer = fs.readFileSync(localPath);
        const remotePath = `runs/${run.test_id}/${remoteName}`;
        const { error } = await this.supabase.storage
          .from("diagnostic-artifacts")
          .upload(remotePath, fileBuffer, { upsert: true });
        if (error) throw new Error(`Storage upload failed for ${remoteName}: ${error.message}`);
      }
    }

    // 2. Upsert metadata into Supabase Postgres
    const { error: dbError } = await this.supabase
      .from("diagnostic_runs")
      .upsert({
        test_id: run.test_id,
        drone_id: run.drone_id,
        motor_label: run.motor_label,
        run_mode: run.run_mode,
        recorded_at: run.recorded_at,
        completed_at: run.completed_at,
        microphone_name: run.microphone_name,
        overall_status: run.overall_status,
        final_classification: run.final_classification,
        sync_status: "synced",
      });

    if (dbError) {
      throw new Error(`Supabase upsert failed: ${dbError.message}`);
    }
  }
}
