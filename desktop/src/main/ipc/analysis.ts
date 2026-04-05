/**
 * IPC handlers for analysis / sidecar operations.
 */
import fs from "fs";
import path from "path";
import type { IpcMain } from "electron";
import type { DatabaseService } from "../services/database";
import type { SidecarService } from "../services/sidecar";
import type {
  DiagnosticStatus,
  RunArtifacts,
  SidecarAnalyzeRequest,
  SidecarAnalyzeResponse,
} from "../../shared/types";

export function registerAnalysisHandlers(
  ipcMain: IpcMain,
  sidecar: SidecarService,
  db: DatabaseService,
  appDataDir: string,
): void {
  // ── analyze ─────────────────────────────────────────────────────────────
  ipcMain.handle("analysis:analyze", async (_event, req: SidecarAnalyzeRequest): Promise<SidecarAnalyzeResponse> => {
    try {
      const outputDir = req.outputDir ?? path.join(appDataDir, "runs", req.testId ?? "unknown");
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
        testId: req.testId,
        micName: req.micName,
      }) as {
        status: string;
        test_id: string;
        overall_status: DiagnosticStatus;
        result_json_path: string;
        artifacts: RunArtifacts;
      };

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
        testId: req.testId ?? "",
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

  // ── DB handlers ───────────────────────────────────────────────────────────
  ipcMain.handle("db:get-drone-profiles", () => db.getDroneProfiles());
  ipcMain.handle("db:create-drone-profile", (_e, args) =>
    db.createDroneProfile(args.droneId, args.displayName, args.notes));

  ipcMain.handle("db:get-throttle-presets", () => db.getThrottlePresets());
  ipcMain.handle("db:create-throttle-preset", (_e, preset) =>
    db.createThrottlePreset(preset));

  ipcMain.handle("db:get-baseline-profiles", (_e, args) =>
    db.getBaselineProfiles(args.droneId));

  ipcMain.handle("db:get-diagnostic-runs", (_e, args) =>
    db.getDiagnosticRuns(args.limit, args.offset));

  ipcMain.handle("db:get-diagnostic-run", (_e, args) =>
    db.getDiagnosticRun(args.testId));

  // ── Filesystem helpers ────────────────────────────────────────────────────
  ipcMain.handle("fs:read-image-data-url", (_e, { filePath }: { filePath: string }) => {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = fs.readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${b64}`;
  });
}
