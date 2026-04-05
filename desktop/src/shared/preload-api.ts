/**
 * AppApi interface — the shape of window.api exposed by the preload script.
 *
 * This file has NO Electron imports so it can be safely imported by both
 * the main-process preload and the renderer (via env.d.ts).
 */
import type {
  AppSettings,
  BetaflightConnectRequest,
  BetaflightConnectResponse,
  BaselineProfile,
  DiagnosticRun,
  DroneProfile,
  MotorRunRequest,
  SidecarAnalyzeRequest,
  SidecarAnalyzeResponse,
  ThrottlePreset,
} from "./types";

export interface AudioDevice {
  index: number;
  name: string;
  max_input_channels: number;
  default_samplerate: number;
}

export interface AppApi {
  // ── Analysis / sidecar ────────────────────────────────────────────────
  analyze: (req: SidecarAnalyzeRequest) => Promise<SidecarAnalyzeResponse>;
  generateBaseline: (
    wavPath: string,
    outPath: string,
    startS: number,
    endS: number,
  ) => Promise<{ status: string; path: string }>;
  averageBaselines: (
    npzPaths: string[],
    droneId: string,
    throttlePreset: string,
  ) => Promise<{ status: string; path: string; captureCount: number }>;

  // ── Audio recording ───────────────────────────────────────────────────
  listAudioDevices: () => Promise<AudioDevice[]>;
  recordAudio: (args: {
    outPath: string;
    duration: number;
    deviceIndex?: number;
  }) => Promise<{ path: string }>;

  // ── Betaflight serial ─────────────────────────────────────────────────
  listSerialPorts: () => Promise<{ path: string; manufacturer?: string }[]>;
  connectBetaflight: (
    req: BetaflightConnectRequest,
  ) => Promise<BetaflightConnectResponse>;
  disconnectBetaflight: () => Promise<void>;
  snapshotBetaflightConfig: () => Promise<{
    success: boolean;
    snapshot?: unknown;
    error?: string;
  }>;
  restoreBetaflightConfig: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  applyTestSessionConfig: () => Promise<{ success: boolean; error?: string }>;
  runMotor: (
    req: MotorRunRequest,
  ) => Promise<{ success: boolean; error?: string }>;
  stopAllMotors: () => Promise<{ success: boolean; error?: string }>;

  // ── Database — drone profiles ─────────────────────────────────────────
  getDroneProfiles: () => Promise<DroneProfile[]>;
  createDroneProfile: (
    droneId: string,
    displayName: string,
    notes?: string,
  ) => Promise<DroneProfile>;

  // ── Database — throttle presets ───────────────────────────────────────
  getThrottlePresets: () => Promise<ThrottlePreset[]>;
  createThrottlePreset: (
    preset: Omit<ThrottlePreset, "id" | "created_at" | "updated_at">,
  ) => Promise<ThrottlePreset>;

  // ── Database — baseline profiles ──────────────────────────────────────
  getBaselineProfiles: (droneId: string) => Promise<BaselineProfile[]>;

  // ── Database — diagnostic runs ────────────────────────────────────────
  getDiagnosticRuns: (limit?: number, offset?: number) => Promise<DiagnosticRun[]>;
  getDiagnosticRun: (testId: string) => Promise<DiagnosticRun | null>;

  // ── Settings ──────────────────────────────────────────────────────────
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;

  // ── Filesystem ────────────────────────────────────────────────────────
  readImageAsDataUrl: (filePath: string) => Promise<string>;
  showSaveDialog: (defaultPath?: string) => Promise<string | undefined>;

  // ── Events from main process ──────────────────────────────────────────
  onMotorRunProgress: (
    callback: (data: {
      motorIndex: number;
      stage: string;
      message: string;
    }) => void,
  ) => () => void;
  onSyncStatusChange: (
    callback: (data: { testId: string; status: string }) => void,
  ) => () => void;
}
