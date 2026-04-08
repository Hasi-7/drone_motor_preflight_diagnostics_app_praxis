/**
 * IPC handlers for analysis / sidecar operations.
 *
 * After a successful analysis run, the handler:
 *   1. Persists the run metadata to SQLite via DatabaseService
 *   2. Enqueues the run for remote upload via SyncService
 *   3. Returns the SidecarAnalyzeResponse to the renderer
 */
import fs from "fs";
import path from "path";
import { dialog } from "electron";
import type { IpcMain } from "electron";
import type { DatabaseService } from "../services/database";
import type { SidecarService } from "../services/sidecar";
import type { SyncService } from "../services/sync";
import type {
  DiagnosticStatus,
  RunArtifacts,
  SidecarAnalyzeRequest,
  SidecarAnalyzeResponse,
} from "../../shared/types";
import type { AudioDevice } from "../../shared/preload-api";

export function registerAnalysisHandlers(
  ipcMain: IpcMain,
  sidecar: SidecarService,
  db: DatabaseService,
  appDataDir: string,
  syncService: SyncService,
): void {
  // ── analyze ─────────────────────────────────────────────────────────────
  ipcMain.handle("analysis:analyze", async (_event, req: SidecarAnalyzeRequest): Promise<SidecarAnalyzeResponse> => {
    const testId = req.testId ?? crypto.randomUUID();
    // Always generate an absolute output directory in the main process.
    // Renderer-supplied outputDir is intentionally ignored: relative paths
    // written by the sidecar (cwd = repoRoot) cannot be resolved correctly
    // by Electron later (cwd = desktop/), so the main process is the only
    // place that can produce a path both processes agree on.
    const outputDir = path.join(appDataDir, "runs", testId);

    try {
      const result = await sidecar.analyze({
        wavPath: req.wavPath,
        baselineNpzPath: req.baselineNpzPath,
        droneId: req.droneId,
        throttlePreset: req.throttlePreset,
        baselinesDir: path.join(appDataDir, "baselines"),
        outputDir,
        startS: req.startS,
        endS: req.endS,
        motorName: req.motorName,
        testId,
        micName: req.micName,
      }) as {
        status: string;
        test_id: string;
        overall_status: DiagnosticStatus;
        result_json_path: string;
        artifacts: RunArtifacts;
      };

      // Persist to SQLite when we have sufficient metadata
      if (req.droneId && req.throttlePresetId !== undefined) {
        try {
          const now = new Date().toISOString();
          db.insertDiagnosticRun({
            test_id: result.test_id,
            drone_id: req.droneId,
            motor_label: req.motorName ?? "Motor",
            run_mode: req.runMode ?? "full_sequence",
            throttle_preset_id: req.throttlePresetId,
            recorded_at: now,
            completed_at: now,
            microphone_name: req.micName ?? "",
            overall_status: result.overall_status ?? null,
            final_classification: result.overall_status ?? null,
            results_json_path: result.result_json_path ?? null,
            raw_wav_path: req.wavPath,
            raw_mp3_path: null,
            preprocessed_data_path: result.artifacts?.preprocessed_npz ?? null,
            fft_data_path: result.artifacts?.fft_npz ?? null,
            waveform_graph_path: result.artifacts?.waveform_png ?? null,
            psd_graph_path: result.artifacts?.psd_png ?? null,
            sync_status: "pending",
            retry_count: 0,
            last_sync_error: null,
          });
          syncService.enqueue(result.test_id);
        } catch (dbErr) {
          // Non-fatal: log but don't fail the analysis response
          console.error("Failed to persist run to DB:", dbErr);
        }
      }

      return {
        status: "ok",
        testId: result.test_id,
        overallStatus: result.overall_status,
        resultJsonPath: result.result_json_path,
        artifacts: result.artifacts,
      };
    } catch (err) {
      return {
        status: "error",
        testId,
        overallStatus: null,
        resultJsonPath: null,
        artifacts: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // ── baseline-gen ─────────────────────────────────────────────────────────
  ipcMain.handle("analysis:baseline-gen", async (_event, args: {
    wavPath: string;
    outPath: string;
    startS: number;
    endS: number;
  }) => {
    return sidecar.generateBaseline({
      wavPath: args.wavPath,
      outPath: args.outPath,
      startS: args.startS,
      endS: args.endS,
    });
  });

  // ── baseline-avg ─────────────────────────────────────────────────────────
  ipcMain.handle("analysis:baseline-avg", async (_event, args: {
    npzPaths: string[];
    droneId: string;
    throttlePreset: string;
  }) => {
    return sidecar.averageBaselines({
      npzPaths: args.npzPaths,
      droneId: args.droneId,
      throttlePreset: args.throttlePreset,
      baselinesDir: path.join(appDataDir, "baselines"),
    });
  });

  // ── Audio recording ────────────────────────────────────────────────────────
  ipcMain.handle("audio:list-devices", async () => {
    const result = await sidecar.listDevices() as { status: string; devices: AudioDevice[] };
    return result.devices ?? [];
  });

  ipcMain.handle("audio:record", async (_e, args: {
    outPath: string;
    duration: number;
    deviceIndex?: number;
  }) => {
    // Normalize to absolute so the sidecar writes to a predictable location
    // and the returned path can be read back by Electron without cwd ambiguity.
    const outPath = path.isAbsolute(args.outPath)
      ? args.outPath
      : path.join(appDataDir, args.outPath);
    const result = await sidecar.recordAudio({
      outPath,
      duration: args.duration,
      deviceIndex: args.deviceIndex,
    }) as { status: string; path: string };
    return { path: result.path };
  });

  // ── DB handlers ───────────────────────────────────────────────────────────
  ipcMain.handle("db:get-drone-profiles", () => db.getDroneProfiles());
  ipcMain.handle("db:create-drone-profile", (_e, args: { droneId: string; displayName: string; notes?: string }) =>
    db.createDroneProfile(args.droneId, args.displayName, args.notes));

  ipcMain.handle("db:get-throttle-presets", () => db.getThrottlePresets());
  ipcMain.handle("db:create-throttle-preset", (_e, preset: Parameters<DatabaseService["createThrottlePreset"]>[0]) =>
    db.createThrottlePreset(preset));

  ipcMain.handle("db:get-baseline-profiles", (_e, args: { droneId: string }) =>
    db.getBaselineProfiles(args.droneId));

  ipcMain.handle("db:upsert-baseline-profile", (_e, profile: Parameters<DatabaseService["upsertBaselineProfile"]>[0]) =>
    db.upsertBaselineProfile(profile));

  ipcMain.handle("db:get-diagnostic-runs", (_e, args: { limit?: number; offset?: number }) =>
    db.getDiagnosticRuns(args.limit, args.offset));

  ipcMain.handle("db:get-diagnostic-run", (_e, args: { testId: string }) =>
    db.getDiagnosticRun(args.testId));

  // ── Filesystem helpers ────────────────────────────────────────────────────
  ipcMain.handle("fs:read-image-data-url", (_e, { filePath }: { filePath: string }) => {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = fs.readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${b64}`;
  });

  ipcMain.handle("fs:read-text-file", (_e, { filePath }: { filePath: string }) => {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  });

  ipcMain.handle("fs:show-save-dialog", async (_e, { defaultPath }: { defaultPath?: string }) => {
    const result = await dialog.showSaveDialog({ defaultPath });
    return result.canceled ? undefined : result.filePath;
  });
}
