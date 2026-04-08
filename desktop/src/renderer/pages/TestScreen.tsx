import React, { useEffect, useRef, useState } from "react";
import { EmergencyStop } from "../components/EmergencyStop";
import { SelectField } from "../components/SelectField";
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

function stageStateLabel(status: StageStatus): string {
  if (status === "running") return "Active";
  if (status === "done") return "Complete";
  if (status === "error") return "Error";
  return "Idle";
}

function parseOptionalNumber(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

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

  useEffect(() => {
    const unsub = window.api.onMotorRunProgress(({ motorIndex, message }) => {
      setProgressLog((prev) => [...prev, `[Motor ${motorIndex + 1}] ${message}`]);
    });
    return unsub;
  }, []);

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const selectedDrone = droneProfiles.find((drone) => drone.drone_id === selectedDroneId);
  const selectedDevice = audioDevices.find((device) => device.index === selectedDeviceIndex);
  const selectedStage = stages.find((stage) => stage.status === "running") ?? stages.find((stage) => stage.status === "error");
  const completedStages = stages.filter((stage) => stage.status === "done").length;
  const safetyThreshold = 1200;

  function setStageStatus(id: string, status: StageStatus) {
    setStages((prev) => prev.map((stage) => (stage.id === id ? { ...stage, status } : stage)));
  }

  function log(message: string) {
    setProgressLog((prev) => [...prev, message]);
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

    const motorDurationS = selectedPreset.duration_ms / 1000;
    const recordDurationS = motorDurationS + 2.0;
    const trimStartS = 1.0;
    const trimEndS = motorDurationS + 1.0;
    const deviceIndex = selectedDeviceIndex !== "" ? selectedDeviceIndex : undefined;

    const motorIndices = runMode === "full_sequence" ? [0, 1, 2, 3] : [singleMotorIdx];
    const wavPaths: string[] = [];

    try {
      setStageStatus("connect", "running");
      const conn = await window.api.connectBetaflight({ portPath: selectedPort });
      if (!conn.connected) throw new Error(`Connection failed: ${conn.error}`);
      log(`Connected - ${conn.firmwareVersion}`);
      setStageStatus("connect", "done");

      if (abortRef.current) return await emergencyAbort();

      setStageStatus("snapshot", "running");
      const snap = await window.api.snapshotBetaflightConfig();
      if (!snap.success) throw new Error(`Snapshot failed: ${snap.error}`);
      setStageStatus("snapshot", "done");

      setStageStatus("test-config", "running");
      const testCfg = await window.api.applyTestSessionConfig();
      if (!testCfg.success) throw new Error(`Test config failed: ${testCfg.error}`);
      setStageStatus("test-config", "done");

      if (abortRef.current) return await emergencyAbort();

      setStageStatus("motors", "running");

      for (const idx of motorIndices) {
        if (abortRef.current) break;
        const label = MOTOR_LABELS[idx] ?? `Motor ${idx + 1}`;
        log(`Starting ${label} + recording ${recordDurationS}s...`);

        const wavPath = `runs/${selectedDroneId}/${label.replace(" ", "_")}_${Date.now()}.wav`;

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
          log(`${label} done - audio: ${recordResult.path}`);
          wavPaths.push(recordResult.path);
        }

        const motorPos = motorIndices.indexOf(idx);
        if (motorPos < motorIndices.length - 1) {
          log(`Cooling down ${selectedPreset.cooldown_ms / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, selectedPreset.cooldown_ms));
        }
      }
      setStageStatus("motors", "done");
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setStageStatus(stages.find((stage) => stage.status === "running")?.id ?? "motors", "error");
    } finally {
      setStageStatus("restore", "running");
      const restore = await window.api.restoreBetaflightConfig();
      if (!restore.success) {
        log(`Config restore failed: ${restore.error}. Please power-cycle the drone.`);
        setStageStatus("restore", "error");
      } else {
        setStageStatus("restore", "done");
      }
      await window.api.stopAllMotors();
      await window.api.disconnectBetaflight();
    }

    if (wavPaths.length > 0) {
      setStageStatus("analyze", "running");
      log(`Analyzing ${wavPaths.length} recording(s)...`);

      let lastStatus: DiagnosticStatus | null = null;
      for (const wavPath of wavPaths) {
        const result = await window.api.analyze({
          wavPath,
          droneId: selectedDroneId,
          throttlePreset: String(selectedPresetId),
          startS: trimStartS,
          endS: trimEndS,
          motorName: MOTOR_LABELS[wavPaths.indexOf(wavPath)] ?? "Motor",
          runMode,
          throttlePresetId: typeof selectedPresetId === "number" ? selectedPresetId : undefined,
          micName: audioDevices.find((device) => device.index === selectedDeviceIndex)?.name,
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
    log("Emergency stop triggered - stopping all motors...");
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
    <div className="page">
      <div className="page-header">
        <div>
          <div className="section-label">Diagnostics</div>
          <h1 className="page-title">Motor test</h1>
          <p className="page-subtitle">Configure a controlled run, capture the audio path, and track each pipeline stage in real time.</p>
        </div>
        <div className="page-actions">
          <EmergencyStop onStop={handleEmergencyStop} disabled={!isRunning} />
        </div>
      </div>

      {showThrottleWarning && selectedPreset && (
        <ThrottleWarningModal
          throttleValue={selectedPreset.throttle_value}
          safetyThreshold={safetyThreshold}
          onConfirm={() => {
            setShowThrottleWarning(false);
            void runTest();
          }}
          onCancel={() => setShowThrottleWarning(false)}
        />
      )}

      <div className="metrics-row">
        <div className="metric-card">
          <div className="metric-label">Selected profile</div>
          <div className="metric-value">{selectedDrone?.display_name ?? "No profile selected"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Microphone path</div>
          <div className="metric-value">{selectedDevice?.name ?? "System default"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pipeline progress</div>
          <div className="metric-value">{completedStages} / {stages.length}</div>
        </div>
      </div>

      <div className="two-column">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Configuration</div>
              <div className="card-title">Session inputs</div>
              <div className="card-subtitle">Keep the same density as the existing workflow, but with cleaner grouping and clearer priorities.</div>
            </div>
          </div>

          <div className="stack-lg">
            <div className="form-group">
              <label className="form-label">Serial port</label>
              <SelectField
                value={selectedPort}
                onChange={setSelectedPort}
                disabled={isRunning}
                options={[
                  { value: "", label: "Select flight controller port" },
                  ...serialPorts.map((port) => ({
                    value: port.path,
                    label: `${port.path}${port.manufacturer ? ` (${port.manufacturer})` : ""}`,
                  })),
                ]}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Drone profile</label>
                <SelectField
                  value={selectedDroneId}
                  onChange={setSelectedDroneId}
                  disabled={isRunning}
                  options={[
                    { value: "", label: "Select profile" },
                    ...droneProfiles.map((drone) => ({ value: drone.drone_id, label: drone.display_name })),
                  ]}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Microphone</label>
                <SelectField
                  value={selectedDeviceIndex === "" ? "" : String(selectedDeviceIndex)}
                  onChange={(value) => setSelectedDeviceIndex(parseOptionalNumber(value))}
                  disabled={isRunning}
                  options={[
                    { value: "", label: "Use system default" },
                    ...audioDevices.map((device) => ({ value: String(device.index), label: device.name })),
                  ]}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Throttle preset</label>
              <SelectField
                value={selectedPresetId === "" ? "" : String(selectedPresetId)}
                onChange={(value) => setSelectedPresetId(parseOptionalNumber(value))}
                disabled={isRunning}
                options={[
                  { value: "", label: "Select preset" },
                  ...presets.map((preset) => ({
                    value: String(preset.id),
                    label: `${preset.name} - ${preset.duration_ms / 1000}s run, ${preset.cooldown_ms / 1000}s cooldown${preset.requires_high_throttle_confirm ? " - safety check" : ""}`,
                  })),
                ]}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Run mode</label>
              <div className="segmented">
                <button type="button" className={`segment ${runMode === "full_sequence" ? "active" : ""}`} onClick={() => setRunMode("full_sequence")} disabled={isRunning}>
                  Full sequence
                </button>
                <button type="button" className={`segment ${runMode === "single_motor" ? "active" : ""}`} onClick={() => setRunMode("single_motor")} disabled={isRunning}>
                  Single motor
                </button>
              </div>
            </div>

            {runMode === "single_motor" && (
              <div className="form-group">
                <label className="form-label">Motor to test</label>
                <SelectField
                  value={String(singleMotorIdx)}
                  onChange={(value) => setSingleMotorIdx(Number(value))}
                  disabled={isRunning}
                  options={MOTOR_LABELS.map((label, index) => ({ value: String(index), label }))}
                />
              </div>
            )}

            {selectedPreset && selectedPreset.throttle_value > safetyThreshold && (
              <div className="warning-banner">Throttle {selectedPreset.throttle_value} exceeds the {safetyThreshold} safety threshold. Props must be removed before testing.</div>
            )}

            <button className="btn btn-primary btn-full" disabled={isRunning || !selectedPort || !selectedDroneId || !selectedPresetId} onClick={handleStartTest}>
              {isRunning ? "Running diagnostic..." : "Start test"}
            </button>
          </div>
        </section>

        <div className="stack-lg">
          <section className="card">
            <div className="card-header">
              <div>
                <div className="section-label">Pipeline</div>
                <div className="card-title">Stage tracker</div>
                <div className="card-subtitle">Active steps glow, completed steps turn green, and the most recent detail stays readable at a glance.</div>
              </div>
            </div>

            <div className="pipeline">
              {stages.map((stage) => (
                <div key={stage.id} className="pipeline-item">
                  <div className="pipeline-rail">
                    <div className={`pipeline-dot ${stage.status}`} />
                  </div>
                  <div className="pipeline-content">
                    <div className="pipeline-title-row">
                      <div className="pipeline-title">{stage.label}</div>
                      <div className={`pipeline-state ${stage.status}`}>{stageStateLabel(stage.status)}</div>
                    </div>
                    <div className="pipeline-meta">
                      {selectedStage?.id === stage.id
                        ? "Receiving live process updates"
                        : stage.status === "done"
                          ? "Finished successfully"
                          : stage.status === "error"
                            ? "Review the activity log for details"
                            : "Waiting for upstream stages"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <div className="section-label">Activity</div>
                <div className="card-title">Progress log</div>
              </div>
            </div>
            <div className="log-panel">
              {progressLog.length === 0 ? (
                <div className="helper-text">No session events yet. Start a test to stream controller, recording, and analysis updates here.</div>
              ) : (
                <div className="log-list">
                  {progressLog.map((message, index) => <div key={`${message}-${index}`} className="log-line">{message}</div>)}
                </div>
              )}
            </div>
          </section>

          {overallStatus && (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="section-label">Result</div>
                  <div className="card-title">Overall classification</div>
                </div>
              </div>
              <DiagnosticBadge status={overallStatus} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
