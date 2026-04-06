import React, { useEffect, useRef, useState } from "react";
import { EmergencyStop } from "../components/EmergencyStop";
import { ThrottleWarningModal } from "../components/ThrottleWarning";
import { DiagnosticBadge } from "../components/StatusBadge";
import type { DiagnosticStatus, DroneProfile, ThrottlePreset } from "../../shared/types";
import type { AudioDevice } from "../../shared/preload-api";

type RunMode = "full_sequence" | "single_motor";
type StageStatus = "pending" | "running" | "done" | "error";

interface Stage {
  id: string;
  label: string;
  status: StageStatus;
}

const MOTOR_LABELS = ["Motor 1", "Motor 2", "Motor 3", "Motor 4"];

const INITIAL_STAGES: Stage[] = [
  { id: "connect", label: "Connect to flight controller", status: "pending" },
  { id: "snapshot", label: "Snapshot Betaflight config", status: "pending" },
  { id: "test-config", label: "Apply test session config", status: "pending" },
  { id: "motors", label: "Run motor sequence + record audio", status: "pending" },
  { id: "restore", label: "Restore Betaflight config", status: "pending" },
  { id: "analyze", label: "Analyze audio", status: "pending" },
  { id: "save", label: "Save results", status: "pending" },
];

export function TestScreen() {
  const [droneProfiles, setDroneProfiles] = useState<DroneProfile[]>([]);
  const [presets, setPresets] = useState<ThrottlePreset[]>([]);
  const [serialPorts, setSerialPorts] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);

  const [selectedDroneId, setSelectedDroneId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<number | "">("");
  const [selectedPort, setSelectedPort] = useState("");
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState<number | "">("");
  const [runMode, setRunMode] = useState<RunMode>("full_sequence");
  const [singleMotorIdx, setSingleMotorIdx] = useState(0);

  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>(INITIAL_STAGES);
  const [overallStatus, setOverallStatus] = useState<DiagnosticStatus | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);

  const [showThrottleWarning, setShowThrottleWarning] = useState(false);

  const abortRef = useRef(false);

  useEffect(() => {
    window.api.getDroneProfiles().then(setDroneProfiles);
    window.api.getThrottlePresets().then(setPresets);
    window.api.listSerialPorts().then(setSerialPorts);
    window.api.listAudioDevices().then(setAudioDevices);
  }, []);

  // Subscribe to motor progress events
  useEffect(() => {
    const unsub = window.api.onMotorRunProgress(({ motorIndex, message }) => {
      setProgressLog((prev) => [...prev, `[Motor ${motorIndex + 1}] ${message}`]);
    });
    return unsub;
  }, []);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const safetyThreshold = 1200; // loaded from settings in production

  function setStageStatus(id: string, status: StageStatus) {
    setStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status } : s))
    );
  }

  function log(msg: string) {
    setProgressLog((prev) => [...prev, msg]);
  }

  async function handleStartTest() {
    if (!selectedPreset) return;
    if (selectedPreset.requires_high_throttle_confirm || selectedPreset.throttle_value > safetyThreshold) {
      setShowThrottleWarning(true);
      return;
    }
    await runTest();
  }

  async function runTest() {
    if (!selectedPreset) return;
    setIsRunning(true);
    abortRef.current = false;
    setStages(INITIAL_STAGES);
    setProgressLog([]);
    setOverallStatus(null);

    // Recording params: motor duration + 2s trim buffer
    const motorDurationS = selectedPreset.duration_ms / 1000;
    const recordDurationS = motorDurationS + 2.0;
    const trimStartS = 1.0;
    const trimEndS = motorDurationS + 1.0;
    const deviceIndex = selectedDeviceIndex !== "" ? selectedDeviceIndex : undefined;

    const motorIndices = runMode === "full_sequence" ? [0, 1, 2, 3] : [singleMotorIdx];
    const wavPaths: string[] = [];

    try {
      // Stage: connect
      setStageStatus("connect", "running");
      const conn = await window.api.connectBetaflight({ portPath: selectedPort });
      if (!conn.connected) throw new Error(`Connection failed: ${conn.error}`);
      log(`Connected — ${conn.firmwareVersion}`);
      setStageStatus("connect", "done");

      if (abortRef.current) return await emergencyAbort();

      // Stage: snapshot
      setStageStatus("snapshot", "running");
      const snap = await window.api.snapshotBetaflightConfig();
      if (!snap.success) throw new Error(`Snapshot failed: ${snap.error}`);
      setStageStatus("snapshot", "done");

      // Stage: apply test config
      setStageStatus("test-config", "running");
      const testCfg = await window.api.applyTestSessionConfig();
      if (!testCfg.success) throw new Error(`Test config failed: ${testCfg.error}`);
      setStageStatus("test-config", "done");

      if (abortRef.current) return await emergencyAbort();

      // Stage: run motors + concurrent audio recording
      setStageStatus("motors", "running");

      for (const idx of motorIndices) {
        if (abortRef.current) break;
        const label = MOTOR_LABELS[idx] ?? `Motor ${idx + 1}`;
        log(`Starting ${label} + recording ${recordDurationS}s...`);

        const wavPath = `app-data/runs/${selectedDroneId}/${label.replace(" ", "_")}_${Date.now()}.wav`;

        const [motorResult, recordResult] = await Promise.all([
          window.api.runMotor({
            motorIndex: idx,
            throttleValue: selectedPreset.throttle_value,
            durationMs: selectedPreset.duration_ms,
          }),
          window.api.recordAudio({ outPath: wavPath, duration: recordDurationS, deviceIndex }),
        ]);

        if (!motorResult.success) {
          log(`Error on ${label}: ${motorResult.error}`);
        } else {
          log(`${label} done — audio: ${recordResult.path}`);
          wavPaths.push(recordResult.path);
        }

        // Cooldown between motors
        const motorPos = motorIndices.indexOf(idx);
        if (motorPos < motorIndices.length - 1) {
          log(`Cooling down ${selectedPreset.cooldown_ms / 1000}s...`);
          await new Promise((r) => setTimeout(r, selectedPreset.cooldown_ms));
        }
      }
      setStageStatus("motors", "done");

    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setStageStatus(stages.find((s) => s.status === "running")?.id ?? "motors", "error");
    } finally {
      // Always restore config
      setStageStatus("restore", "running");
      const restore = await window.api.restoreBetaflightConfig();
      if (!restore.success) {
        log(`⚠ Config restore FAILED: ${restore.error}. Please power-cycle the drone.`);
        setStageStatus("restore", "error");
      } else {
        setStageStatus("restore", "done");
      }
      await window.api.stopAllMotors();
      await window.api.disconnectBetaflight();
    }

    // Stage: analyze each recorded WAV
    if (wavPaths.length > 0) {
      setStageStatus("analyze", "running");
      log(`Analyzing ${wavPaths.length} recording(s)...`);

      let lastStatus: DiagnosticStatus | null = null;
      for (const wavPath of wavPaths) {
        const result = await window.api.analyze({
          wavPath,
          droneId: selectedDroneId,
          throttlePreset: String(selectedPresetId),
          outputDir: `app-data/runs/${Date.now()}`,
          startS: trimStartS,
          endS: trimEndS,
          motorName: MOTOR_LABELS[wavPaths.indexOf(wavPath)] ?? "Motor",
          runMode,
          throttlePresetId: typeof selectedPresetId === "number" ? selectedPresetId : undefined,
          micName: audioDevices.find((d) => d.index === selectedDeviceIndex)?.name,
        });
        if (result.overallStatus) lastStatus = result.overallStatus;
        log(`Analysis: ${result.overallStatus ?? result.error ?? "unknown"}`);
      }

      setStageStatus("analyze", "done");
      if (lastStatus) setOverallStatus(lastStatus);
    }

    setStageStatus("save", "done");
    setIsRunning(false);
  }

  async function emergencyAbort() {
    log("Emergency stop triggered — stopping all motors...");
    await window.api.stopAllMotors();
    await window.api.restoreBetaflightConfig();
    await window.api.disconnectBetaflight();
    setIsRunning(false);
  }

  async function handleEmergencyStop() {
    abortRef.current = true;
    await emergencyAbort();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Motor Test</h1>
        <p>Run a motor diagnostic session using Betaflight serial control.</p>
      </div>

      {showThrottleWarning && selectedPreset && (
        <ThrottleWarningModal
          throttleValue={selectedPreset.throttle_value}
          safetyThreshold={safetyThreshold}
          onConfirm={() => { setShowThrottleWarning(false); void runTest(); }}
          onCancel={() => setShowThrottleWarning(false)}
        />
      )}

      <div className="grid-2" style={{ alignItems: "start" }}>
        {/* Left: configuration */}
        <div>
          <div className="card">
            <div className="card-title">Configuration</div>

            <div className="form-group">
              <label className="form-label">Serial Port (Flight Controller)</label>
              <select
                className="form-select"
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                disabled={isRunning}
              >
                <option value="">— Select port —</option>
                {serialPorts.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}{p.manufacturer ? ` (${p.manufacturer})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Microphone</label>
              <select
                className="form-select"
                value={selectedDeviceIndex}
                onChange={(e) => setSelectedDeviceIndex(Number(e.target.value) || "")}
                disabled={isRunning}
              >
                <option value="">— System default —</option>
                {audioDevices.map((d) => (
                  <option key={d.index} value={d.index}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Drone Profile</label>
              <select
                className="form-select"
                value={selectedDroneId}
                onChange={(e) => setSelectedDroneId(e.target.value)}
                disabled={isRunning}
              >
                <option value="">— Select drone —</option>
                {droneProfiles.map((d) => (
                  <option key={d.drone_id} value={d.drone_id}>{d.display_name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Throttle Preset</label>
              <select
                className="form-select"
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(Number(e.target.value) || "")}
                disabled={isRunning}
              >
                <option value="">— Select preset —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.duration_ms / 1000}s, cooldown {p.cooldown_ms / 1000}s
                    {p.requires_high_throttle_confirm ? " ⚠" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Run Mode</label>
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" value="full_sequence" checked={runMode === "full_sequence"}
                    onChange={() => setRunMode("full_sequence")} disabled={isRunning} />
                  Full sequence (all 4 motors)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" value="single_motor" checked={runMode === "single_motor"}
                    onChange={() => setRunMode("single_motor")} disabled={isRunning} />
                  Single motor
                </label>
              </div>
            </div>

            {runMode === "single_motor" && (
              <div className="form-group">
                <label className="form-label">Motor to Test</label>
                <select className="form-select" value={singleMotorIdx}
                  onChange={(e) => setSingleMotorIdx(Number(e.target.value))} disabled={isRunning}>
                  {MOTOR_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </div>
            )}

            {selectedPreset && selectedPreset.throttle_value > safetyThreshold && (
              <div className="warning-banner">
                ⚠ Throttle {selectedPreset.throttle_value} exceeds {safetyThreshold}. Props must be removed.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={isRunning || !selectedPort || !selectedDroneId || !selectedPresetId}
                onClick={handleStartTest}
              >
                {isRunning ? "Running…" : "Start Test"}
              </button>
            </div>
          </div>
        </div>

        {/* Right: progress + emergency stop */}
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <EmergencyStop onStop={handleEmergencyStop} disabled={!isRunning} />
          </div>

          <div className="card">
            <div className="card-title">Pipeline Stages</div>
            <div className="stage-list">
              {stages.map((s) => (
                <div key={s.id} className="stage-item">
                  <div className={`stage-dot ${s.status}`} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  {s.status === "running" && <span style={{ color: "var(--color-accent)", fontSize: 11 }}>…</span>}
                  {s.status === "done" && <span style={{ color: "var(--color-green)", fontSize: 11 }}>✓</span>}
                  {s.status === "error" && <span style={{ color: "var(--color-red)", fontSize: 11 }}>✕</span>}
                </div>
              ))}
            </div>
          </div>

          {progressLog.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">Progress Log</div>
              <div style={{ fontFamily: "monospace", fontSize: 12, maxHeight: 180, overflowY: "auto" }}>
                {progressLog.map((msg, i) => (
                  <div key={i} style={{ padding: "2px 0", color: "var(--color-text-muted)" }}>{msg}</div>
                ))}
              </div>
            </div>
          )}

          {overallStatus && (
            <div className="card" style={{ marginTop: 12, textAlign: "center" }}>
              <div className="card-title">Overall Result</div>
              <DiagnosticBadge status={overallStatus} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
