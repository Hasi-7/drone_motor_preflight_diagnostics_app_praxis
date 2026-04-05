import React, { useEffect, useRef, useState } from "react";
import type { DroneProfile, ThrottlePreset } from "../../shared/types";

const REQUIRED_CAPTURES = 5;

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

  const [selectedDroneId, setSelectedDroneId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<number | "">("");
  const [selectedPort, setSelectedPort] = useState("");

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
  }, []);

  const preset = presets.find((p) => p.id === selectedPresetId);
  const canStart = selectedDroneId && selectedPresetId && selectedPort && !isCapturing && !done;

  function addLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  function updateCapture(index: number, fields: Partial<CaptureRun>) {
    setCaptures((prev) =>
      prev.map((c) => (c.index === index ? { ...c, ...fields } : c))
    );
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

    const initialCaptures = Array.from({ length: REQUIRED_CAPTURES }, (_, i) => ({
      index: i,
      status: "pending" as const,
    }));
    setCaptures(initialCaptures);

    const npzPaths: string[] = [];

    try {
      // Connect
      addLog("Connecting to flight controller...");
      const conn = await window.api.connectBetaflight({ portPath: selectedPort });
      if (!conn.connected) throw new Error(`Connection failed: ${conn.error}`);
      addLog(`Connected — ${conn.firmwareVersion}`);

      await window.api.snapshotBetaflightConfig();
      await window.api.applyTestSessionConfig();

      for (let i = 0; i < REQUIRED_CAPTURES; i++) {
        updateCapture(i, { status: "running" });
        addLog(`Capture ${i + 1}/${REQUIRED_CAPTURES}...`);

        // TODO: integrate audio recording — for now we placeholder with a dummy wav path
        // The real flow would: start audio recording → run motor → stop recording → save WAV
        const dummyWavPath = `app-data/baselines/${selectedDroneId}/${selectedPresetId}/capture_${i}.wav`;
        const outPath = `app-data/baselines/${selectedDroneId}/${selectedPresetId}/run${i}.npz`;

        // Run motor
        const motorResult = await window.api.runMotor({
          motorIndex: 0, // baseline always uses motor 0 as reference
          throttleValue: preset.throttle_value,
          durationMs: preset.duration_ms,
        });

        if (!motorResult.success) {
          updateCapture(i, { status: "error", error: motorResult.error });
          addLog(`Capture ${i + 1} failed: ${motorResult.error}`);
          continue;
        }

        // Generate baseline npz from the recording
        const genResult = await window.api.generateBaseline(dummyWavPath, outPath, 2.0, 8.0);
        if (genResult.status === "ok") {
          npzPaths.push(genResult.path);
          updateCapture(i, { status: "done", npzPath: genResult.path });
          addLog(`Capture ${i + 1} saved → ${genResult.path}`);
        } else {
          updateCapture(i, { status: "error", error: "Analysis failed" });
        }

        // Cooldown between captures
        if (i < REQUIRED_CAPTURES - 1) {
          addLog(`Cooldown ${preset.cooldown_ms / 1000}s...`);
          await new Promise((r) => setTimeout(r, preset.cooldown_ms));
        }
      }

    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await window.api.stopAllMotors();
      await window.api.restoreBetaflightConfig();
      await window.api.disconnectBetaflight();
    }

    // Average captures that succeeded
    const successfulPaths = npzPaths;
    if (successfulPaths.length >= 3) {
      setIsAveraging(true);
      addLog(`Averaging ${successfulPaths.length} captures into baseline...`);
      const avgResult = await window.api.averageBaselines(
        successfulPaths,
        selectedDroneId,
        String(selectedPresetId),
      );
      addLog(`Baseline saved → ${avgResult.path} (${avgResult.captureCount} captures)`);
      setIsAveraging(false);
      setDone(true);
    } else {
      addLog("⚠ Not enough successful captures to create a baseline (need at least 3).");
    }

    setIsCapturing(false);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Baseline Setup</h1>
        <p>Record {REQUIRED_CAPTURES} healthy runs to create a per-drone, per-throttle baseline profile.</p>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div>
          <div className="card">
            <div className="card-title">Profile</div>

            <div className="form-group">
              <label className="form-label">Drone Profile</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select className="form-select" value={selectedDroneId}
                  onChange={(e) => setSelectedDroneId(e.target.value)} disabled={isCapturing}>
                  <option value="">— Select drone —</option>
                  {droneProfiles.map((d) => (
                    <option key={d.drone_id} value={d.drone_id}>{d.display_name}</option>
                  ))}
                </select>
                <button className="btn btn-secondary" onClick={() => setShowNewDroneForm((v) => !v)} disabled={isCapturing}>
                  +
                </button>
              </div>
            </div>

            {showNewDroneForm && (
              <div style={{ background: "var(--color-surface-2)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
                <div className="form-group">
                  <label className="form-label">Drone ID</label>
                  <input className="form-input" placeholder="e.g. freestyle-001" value={newDroneId}
                    onChange={(e) => setNewDroneId(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Display Name</label>
                  <input className="form-input" placeholder="e.g. Freestyle Quad #1" value={newDroneName}
                    onChange={(e) => setNewDroneName(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleCreateDrone}
                  disabled={!newDroneId || !newDroneName}>
                  Create Profile
                </button>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Throttle Preset</label>
              <select className="form-select" value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(Number(e.target.value) || "")} disabled={isCapturing}>
                <option value="">— Select preset —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Serial Port</label>
              <select className="form-select" value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)} disabled={isCapturing}>
                <option value="">— Select port —</option>
                {serialPorts.map((p) => (
                  <option key={p.path} value={p.path}>{p.path}</option>
                ))}
              </select>
            </div>

            <button className="btn btn-primary" style={{ width: "100%" }}
              disabled={!canStart} onClick={handleStartOnboarding}>
              {isCapturing ? "Capturing…" : isAveraging ? "Averaging…" : "Start Baseline Onboarding"}
            </button>

            {done && (
              <div style={{ marginTop: 12, padding: 12, background: "#14532d", borderRadius: 6, color: "var(--color-green)", textAlign: "center", fontWeight: 600 }}>
                ✓ Baseline created successfully
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">Capture Progress ({REQUIRED_CAPTURES} runs required)</div>
            {captures.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                Start onboarding to begin recording healthy captures.
              </p>
            ) : (
              <div className="stage-list">
                {captures.map((c) => (
                  <div key={c.index} className="stage-item">
                    <div className={`stage-dot ${c.status}`} />
                    <span>Capture {c.index + 1}</span>
                    {c.status === "done" && <span style={{ color: "var(--color-green)", fontSize: 11 }}>✓</span>}
                    {c.status === "error" && <span style={{ color: "var(--color-red)", fontSize: 12 }}>{c.error}</span>}
                    {c.status === "running" && <span style={{ color: "var(--color-accent)", fontSize: 11 }}>Recording…</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {log.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">Log</div>
              <div style={{ fontFamily: "monospace", fontSize: 12, maxHeight: 200, overflowY: "auto" }}>
                {log.map((msg, i) => <div key={i} style={{ padding: "2px 0", color: "var(--color-text-muted)" }}>{msg}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
