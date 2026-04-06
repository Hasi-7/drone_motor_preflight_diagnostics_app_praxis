/**
 * Shared TypeScript types used by both the main process and the renderer.
 *
 * These types mirror the Python analysis models and the SQLite schema so that
 * IPC payloads are strongly typed end-to-end.
 */

// ── Diagnostic classification ──────────────────────────────────────────────

export type DiagnosticStatus = "READY TO FLY" | "WARNING" | "DO NOT FLY";
export type SyncStatus = "pending" | "syncing" | "synced" | "error";
export type RunMode = "full_sequence" | "single_motor";

// ── Fault check result (mirrors analysis.models.FaultCheckResult) ──────────

export interface FaultCheckResult {
  fault_name: string;
  label: DiagnosticStatus;
  icon: string;
  deviation_db: number;
  band_description: string;
  severity: 0 | 1 | 2;
}

// ── Diagnostic result (mirrors analysis.models.DiagnosticResult) ───────────

export interface DiagnosticResult {
  motor_name: string;
  shaft_freq_hz: number;
  shaft_rpm: number;
  overall_status: DiagnosticStatus;
  overall_icon: string;
  fault_checks: FaultCheckResult[];
}

// ── Run artifact paths ─────────────────────────────────────────────────────

export interface RunArtifacts {
  test_id: string;
  output_dir: string;
  waveform_png: string | null;
  psd_png: string | null;
  preprocessed_npz: string | null;
  fft_npz: string | null;
  result_json: string | null;
}

// ── SQLite table row types ─────────────────────────────────────────────────

export interface DroneProfile {
  id: number;
  drone_id: string;
  display_name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ThrottlePreset {
  id: number;
  name: string;
  throttle_value: number;
  duration_ms: number;
  cooldown_ms: number;
  mic_name: string;
  requires_high_throttle_confirm: boolean;
  created_at: string;
  updated_at: string;
}

export interface BaselineProfile {
  id: number;
  drone_id: string;
  throttle_preset_id: number;
  capture_count: number;
  baseline_result_path: string;
  baseline_preprocessed_path: string;
  baseline_fft_path: string;
  baseline_plot_path: string;
  created_at: string;
  updated_at: string;
}

export interface DiagnosticRun {
  id: number;
  test_id: string;
  drone_id: string;
  motor_label: string;
  run_mode: RunMode;
  throttle_preset_id: number;
  recorded_at: string;
  completed_at: string | null;
  microphone_name: string;
  overall_status: DiagnosticStatus | null;
  final_classification: string | null;
  results_json_path: string | null;
  raw_wav_path: string | null;
  raw_mp3_path: string | null;
  preprocessed_data_path: string | null;
  fft_data_path: string | null;
  waveform_graph_path: string | null;
  psd_graph_path: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadJob {
  id: number;
  test_id: string;
  status: SyncStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ── IPC channel message shapes ─────────────────────────────────────────────

export interface SidecarAnalyzeRequest {
  wavPath: string;
  baselineNpzPath?: string;
  droneId?: string;
  throttlePreset?: string;
  outputDir: string;
  startS?: number;
  endS?: number;
  motorName?: string;
  testId?: string;
  micName?: string;
  // Required for DB persistence after analysis
  runMode?: RunMode;
  throttlePresetId?: number;
}

export interface SidecarAnalyzeResponse {
  status: "ok" | "error";
  testId: string;
  overallStatus: DiagnosticStatus | null;
  resultJsonPath: string | null;
  artifacts: RunArtifacts | null;
  error?: string;
}

export interface BetaflightConnectRequest {
  portPath: string;
  baudRate?: number;
}

export interface BetaflightConnectResponse {
  connected: boolean;
  firmwareVersion?: string;
  error?: string;
}

export interface MotorRunRequest {
  motorIndex: number;      // 0-3
  throttleValue: number;   // 1000-2000 (Betaflight scale)
  durationMs: number;
}

export interface AppSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  localStoragePath: string;
  defaultMicName: string;
  throttleSafetyThreshold: number;
  autoSyncEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  localStoragePath: "",
  defaultMicName: "",
  throttleSafetyThreshold: 1200,
  autoSyncEnabled: true,
};
