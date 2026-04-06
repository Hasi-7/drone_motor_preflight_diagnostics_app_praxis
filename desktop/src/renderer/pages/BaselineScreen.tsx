import React, { useEffect, useState } from "react";
import { SelectField } from "../components/SelectField";
import type { DroneProfile, ThrottlePreset } from "../../shared/types";
import type { AudioDevice } from "../../shared/preload-api";

const REQUIRED_CAPTURES = 5;

function parseOptionalNumber(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

interface CaptureRun {
  index: number;
  status: "pending" | "running" | "done" | "error";
  npzPath?: string;
  error?: string;
}

export function BaselineScreen() {
  const [droneProfiles, setDroneProfiles] = useState<DroneProfile[]>([]);
  const [presets, setPresets] = useState<ThrottlePreset[]>([]);
  const [serialPorts, setSerialPorts] = useState<{ path: string }[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);

  const [selectedDroneId, setSelectedDroneId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<number | "">("");
  const [selectedPort, setSelectedPort] = useState("");
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState<number | "">("");

  const [captures, setCaptures] = useState<CaptureRun[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAveraging, setIsAveraging] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const [newDroneName, setNewDroneName] = useState("");
  const [newDroneId, setNewDroneId] = useState("");
  const [showNewDroneForm, setShowNewDroneForm] = useState(false);

  useEffect(() => {
    window.api.getDroneProfiles().then(setDroneProfiles);
    window.api.getThrottlePresets().then(setPresets);
    window.api.listSerialPorts().then(setSerialPorts);
    window.api.listAudioDevices().then(setAudioDevices);
  }, []);

  const preset = presets.find((item) => item.id === selectedPresetId);
  const selectedDrone = droneProfiles.find((item) => item.drone_id === selectedDroneId);
  const completedCaptures = captures.filter((capture) => capture.status === "done").length;
  const canStart = selectedDroneId && selectedPresetId && selectedPort && !isCapturing && !done;

  function addLog(message: string) {
    setLog((prev) => [...prev, message]);
  }

  function updateCapture(index: number, fields: Partial<CaptureRun>) {
    setCaptures((prev) => prev.map((capture) => (capture.index === index ? { ...capture, ...fields } : capture)));
  }

  async function handleCreateDrone() {
    if (!newDroneId || !newDroneName) return;
    const profile = await window.api.createDroneProfile(newDroneId, newDroneName);
    setDroneProfiles((prev) => [...prev, profile]);
    setSelectedDroneId(profile.drone_id);
    setShowNewDroneForm(false);
    setNewDroneId("");
    setNewDroneName("");
  }

  async function handleStartOnboarding() {
    if (!preset) return;
    setIsCapturing(true);
    setDone(false);
    setLog([]);

    const initialCaptures = Array.from({ length: REQUIRED_CAPTURES }, (_, index) => ({
      index,
      status: "pending" as const,
    }));
    setCaptures(initialCaptures);

    const npzPaths: string[] = [];
    const motorDurationS = preset.duration_ms / 1000;
    const recordDurationS = motorDurationS + 2.0;
    const trimStartS = 1.0;
    const trimEndS = motorDurationS + 1.0;

    try {
      addLog("Connecting to flight controller...");
      const conn = await window.api.connectBetaflight({ portPath: selectedPort });
      if (!conn.connected) throw new Error(`Connection failed: ${conn.error}`);
      addLog(`Connected - ${conn.firmwareVersion}`);

      await window.api.snapshotBetaflightConfig();
      await window.api.applyTestSessionConfig();

      for (let i = 0; i < REQUIRED_CAPTURES; i += 1) {
        updateCapture(i, { status: "running" });
        addLog(`Capture ${i + 1}/${REQUIRED_CAPTURES} - recording ${recordDurationS}s...`);

        const wavPath = `app-data/baselines/${selectedDroneId}/${selectedPresetId}/capture_${i}.wav`;
        const outPath = `app-data/baselines/${selectedDroneId}/${selectedPresetId}/run${i}.npz`;
        const deviceIndex = selectedDeviceIndex !== "" ? selectedDeviceIndex : undefined;

        const [motorResult, recordResult] = await Promise.all([
          window.api.runMotor({
            motorIndex: 0,
            throttleValue: preset.throttle_value,
            durationMs: preset.duration_ms,
          }),
          window.api.recordAudio({ outPath: wavPath, duration: recordDurationS, deviceIndex }),
        ]);

        if (!motorResult.success) {
          updateCapture(i, { status: "error", error: motorResult.error });
          addLog(`Capture ${i + 1} motor error: ${motorResult.error}`);
          continue;
        }

        addLog(`Recorded -> ${recordResult.path}`);

        const genResult = await window.api.generateBaseline(recordResult.path, outPath, trimStartS, trimEndS);
        if (genResult.status === "ok") {
          npzPaths.push(genResult.path);
          updateCapture(i, { status: "done", npzPath: genResult.path });
          addLog(`Capture ${i + 1} saved -> ${genResult.path}`);
        } else {
          updateCapture(i, { status: "error", error: "Analysis failed" });
        }

        if (i < REQUIRED_CAPTURES - 1) {
          addLog(`Cooldown ${preset.cooldown_ms / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, preset.cooldown_ms));
        }
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await window.api.stopAllMotors();
      await window.api.restoreBetaflightConfig();
      await window.api.disconnectBetaflight();
    }

    if (npzPaths.length >= 3) {
      setIsAveraging(true);
      addLog(`Averaging ${npzPaths.length} captures into baseline...`);
      const avgResult = await window.api.averageBaselines(npzPaths, selectedDroneId, String(selectedPresetId));
      addLog(`Baseline saved -> ${avgResult.path} (${avgResult.captureCount} captures)`);

      if (typeof selectedPresetId === "number") {
        try {
          await window.api.upsertBaselineProfile({
            drone_id: selectedDroneId,
            throttle_preset_id: selectedPresetId,
            capture_count: avgResult.captureCount,
            baseline_result_path: avgResult.path,
            baseline_preprocessed_path: "",
            baseline_fft_path: "",
            baseline_plot_path: "",
          });
          addLog("Baseline profile saved to local database.");
        } catch (dbErr) {
          addLog(`Warning: could not save baseline to database - ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
        }
      }

      setIsAveraging(false);
      setDone(true);
    } else {
      addLog("Not enough successful captures to create a baseline (need at least 3).");
    }

    setIsCapturing(false);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="section-label">Calibration</div>
          <h1 className="page-title">Baseline setup</h1>
          <p className="page-subtitle">Capture five healthy reference runs for a drone and preset pair, then average them into a reusable baseline profile.</p>
        </div>
      </div>

      <div className="metrics-row">
        <div className="metric-card">
          <div className="metric-label">Selected profile</div>
          <div className="metric-value">{selectedDrone?.display_name ?? "Awaiting selection"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Completed runs</div>
          <div className="metric-value">{completedCaptures} / {REQUIRED_CAPTURES}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Session state</div>
          <div className="metric-value">{done ? "Baseline ready" : isAveraging ? "Averaging" : isCapturing ? "Capturing" : "Idle"}</div>
        </div>
      </div>

      <div className="two-column">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Profile config</div>
              <div className="card-title">Onboarding inputs</div>
              <div className="card-subtitle">Choose the drone, preset, controller port, and microphone before starting the healthy baseline capture run.</div>
            </div>
          </div>

          <div className="stack-lg">
            <div className="form-group">
              <label className="form-label">Drone profile</label>
              <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <SelectField
                  value={selectedDroneId}
                  onChange={setSelectedDroneId}
                  disabled={isCapturing}
                  options={[
                    { value: "", label: "Select profile" },
                    ...droneProfiles.map((drone) => ({ value: drone.drone_id, label: drone.display_name })),
                  ]}
                />
                <button className="btn btn-secondary" onClick={() => setShowNewDroneForm((value) => !value)} disabled={isCapturing}>
                  + New
                </button>
              </div>
            </div>

            {showNewDroneForm && (
              <div className="surface-muted stack-md">
                <div>
                  <div className="section-label">New profile</div>
                  <div className="card-title">Create drone profile</div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Drone ID</label>
                    <input className="field-input" placeholder="freestyle-001" value={newDroneId} onChange={(e) => setNewDroneId(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Display name</label>
                    <input className="field-input" placeholder="Freestyle Quad 1" value={newDroneName} onChange={(e) => setNewDroneName(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-primary btn-full" onClick={handleCreateDrone} disabled={!newDroneId || !newDroneName}>Create profile</button>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Throttle preset</label>
              <SelectField
                value={selectedPresetId === "" ? "" : String(selectedPresetId)}
                onChange={(value) => setSelectedPresetId(parseOptionalNumber(value))}
                disabled={isCapturing}
                options={[
                  { value: "", label: "Select preset" },
                  ...presets.map((item) => ({ value: String(item.id), label: item.name })),
                ]}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Serial port</label>
                <SelectField
                  value={selectedPort}
                  onChange={setSelectedPort}
                  disabled={isCapturing}
                  options={[
                    { value: "", label: "Select controller port" },
                    ...serialPorts.map((port) => ({ value: port.path, label: port.path })),
                  ]}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Microphone</label>
                <SelectField
                  value={selectedDeviceIndex === "" ? "" : String(selectedDeviceIndex)}
                  onChange={(value) => setSelectedDeviceIndex(parseOptionalNumber(value))}
                  disabled={isCapturing}
                  options={[
                    { value: "", label: "Use system default" },
                    ...audioDevices.map((device) => ({ value: String(device.index), label: device.name })),
                  ]}
                />
              </div>
            </div>

            <button className="btn btn-primary btn-full" disabled={!canStart} onClick={handleStartOnboarding}>
              {isCapturing ? "Capturing baseline..." : isAveraging ? "Averaging captures..." : "Start baseline onboarding"}
            </button>

            {done && <div className="success-banner">Baseline created successfully and saved to the local workspace.</div>}
          </div>
        </section>

        <div className="stack-lg">
          <section className="card">
            <div className="card-header">
              <div>
                <div className="section-label">Capture progress</div>
                <div className="card-title">{REQUIRED_CAPTURES} runs required</div>
                <div className="card-subtitle">Each slot fills as a healthy capture succeeds. At least three successful captures are needed to average a baseline.</div>
              </div>
            </div>

            {captures.length === 0 ? (
              <div className="surface-muted">
                <div className="card-title">Ready when you are</div>
                <div className="card-subtitle">Start onboarding to record consistent healthy motor references for this profile.</div>
              </div>
            ) : (
              <div className="stack-md">
                <div className="capture-slots">
                  {captures.map((capture) => (
                    <div
                      key={capture.index}
                      className={`capture-slot ${capture.status === "running" ? "is-running" : ""} ${capture.status === "done" ? "is-done" : ""} ${capture.status === "error" ? "is-error" : ""}`}
                    >
                      <div className="capture-slot-index">Run {capture.index + 1}</div>
                      <div className="capture-slot-status">
                        {capture.status === "pending" ? "Queued" : capture.status === "running" ? "Recording" : capture.status === "done" ? "Saved" : "Issue"}
                      </div>
                    </div>
                  ))}
                </div>
                {captures.some((capture) => capture.status === "error") && (
                  <div className="warning-banner">One or more captures failed. You can still finish if at least three captures succeed.</div>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <div className="section-label">Session log</div>
                <div className="card-title">Capture events</div>
              </div>
            </div>
            <div className="log-panel">
              {log.length === 0 ? (
                <div className="helper-text">Controller, recording, and baseline generation events will stream here once onboarding begins.</div>
              ) : (
                <div className="log-list">
                  {log.map((message, index) => <div key={`${message}-${index}`} className="log-line">{message}</div>)}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
