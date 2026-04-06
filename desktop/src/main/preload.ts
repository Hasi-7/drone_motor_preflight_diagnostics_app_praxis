/**
 * Preload script — exposes a narrow, typed IPC bridge to the renderer.
 *
 * The renderer has NO direct access to Node or Electron APIs.
 * All communication goes through window.api.
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  BetaflightConnectRequest,
  BetaflightConnectResponse,
  DiagnosticRun,
  DroneProfile,
  MotorRunRequest,
  SidecarAnalyzeRequest,
  SidecarAnalyzeResponse,
  ThrottlePreset,
  BaselineProfile,
} from "../shared/types";
import type { AppApi, AudioDevice } from "../shared/preload-api";

const api: AppApi = {
  // ── Analysis / sidecar ────────────────────────────────────────────────
  analyze: (req: SidecarAnalyzeRequest): Promise<SidecarAnalyzeResponse> =>
    ipcRenderer.invoke("analysis:analyze", req),

  generateBaseline: (wavPath: string, outPath: string, startS: number, endS: number): Promise<{ status: string; path: string }> =>
    ipcRenderer.invoke("analysis:baseline-gen", { wavPath, outPath, startS, endS }),

  averageBaselines: (npzPaths: string[], droneId: string, throttlePreset: string): Promise<{ status: string; path: string; captureCount: number }> =>
    ipcRenderer.invoke("analysis:baseline-avg", { npzPaths, droneId, throttlePreset }),

  // ── Audio recording ───────────────────────────────────────────────────
  listAudioDevices: (): Promise<AudioDevice[]> =>
    ipcRenderer.invoke("audio:list-devices"),

  recordAudio: (args: { outPath: string; duration: number; deviceIndex?: number }): Promise<{ path: string }> =>
    ipcRenderer.invoke("audio:record", args),

  // ── Betaflight serial ─────────────────────────────────────────────────
  listSerialPorts: (): Promise<{ path: string; manufacturer?: string }[]> =>
    ipcRenderer.invoke("betaflight:list-ports"),

  connectBetaflight: (req: BetaflightConnectRequest): Promise<BetaflightConnectResponse> =>
    ipcRenderer.invoke("betaflight:connect", req),

  disconnectBetaflight: (): Promise<void> =>
    ipcRenderer.invoke("betaflight:disconnect"),

  snapshotBetaflightConfig: (): Promise<{ success: boolean; snapshot?: unknown; error?: string }> =>
    ipcRenderer.invoke("betaflight:snapshot-config"),

  restoreBetaflightConfig: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("betaflight:restore-config"),

  applyTestSessionConfig: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("betaflight:apply-test-config"),

  runMotor: (req: MotorRunRequest): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("betaflight:run-motor", req),

  stopAllMotors: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("betaflight:stop-all-motors"),

  // ── Database — drone profiles ─────────────────────────────────────────
  getDroneProfiles: (): Promise<DroneProfile[]> =>
    ipcRenderer.invoke("db:get-drone-profiles"),

  createDroneProfile: (droneId: string, displayName: string, notes?: string): Promise<DroneProfile> =>
    ipcRenderer.invoke("db:create-drone-profile", { droneId, displayName, notes }),

  // ── Database — throttle presets ───────────────────────────────────────
  getThrottlePresets: (): Promise<ThrottlePreset[]> =>
    ipcRenderer.invoke("db:get-throttle-presets"),

  createThrottlePreset: (preset: Omit<ThrottlePreset, "id" | "created_at" | "updated_at">): Promise<ThrottlePreset> =>
    ipcRenderer.invoke("db:create-throttle-preset", preset),

  // ── Database — baseline profiles ──────────────────────────────────────
  getBaselineProfiles: (droneId: string): Promise<BaselineProfile[]> =>
    ipcRenderer.invoke("db:get-baseline-profiles", { droneId }),

  upsertBaselineProfile: (
    profile: Omit<BaselineProfile, "id" | "created_at" | "updated_at">
  ): Promise<BaselineProfile> =>
    ipcRenderer.invoke("db:upsert-baseline-profile", profile),

  // ── Database — diagnostic runs ────────────────────────────────────────
  getDiagnosticRuns: (limit?: number, offset?: number): Promise<DiagnosticRun[]> =>
    ipcRenderer.invoke("db:get-diagnostic-runs", { limit, offset }),

  getDiagnosticRun: (testId: string): Promise<DiagnosticRun | null> =>
    ipcRenderer.invoke("db:get-diagnostic-run", { testId }),

  // ── Settings ──────────────────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:get"),

  saveSettings: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke("settings:save", settings),

  // ── Filesystem ────────────────────────────────────────────────────────
  readImageAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("fs:read-image-data-url", { filePath }),

  readTextFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("fs:read-text-file", { filePath }),

  showSaveDialog: (defaultPath?: string): Promise<string | undefined> =>
    ipcRenderer.invoke("fs:show-save-dialog", { defaultPath }),

  // ── Events from main process ──────────────────────────────────────────
  onMotorRunProgress: (callback: (data: { motorIndex: number; stage: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data as { motorIndex: number; stage: string; message: string });
    ipcRenderer.on("motor:run-progress", handler);
    return () => ipcRenderer.removeListener("motor:run-progress", handler);
  },

  onSyncStatusChange: (callback: (data: { testId: string; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data as { testId: string; status: string });
    ipcRenderer.on("sync:status-change", handler);
    return () => ipcRenderer.removeListener("sync:status-change", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
