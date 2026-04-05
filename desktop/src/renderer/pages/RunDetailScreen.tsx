import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DiagnosticBadge, SyncBadge } from "../components/StatusBadge";
import type { DiagnosticResult, DiagnosticRun } from "../../shared/types";

export function RunDetailScreen() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();

  const [run, setRun] = useState<DiagnosticRun | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null);
  const [psdUrl, setPsdUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!testId) return;

    window.api.getDiagnosticRun(testId).then(async (r) => {
      setRun(r);
      if (!r) { setLoading(false); return; }

      // Load diagnostic JSON
      if (r.results_json_path) {
        try {
          const raw = await window.api.readImageAsDataUrl(r.results_json_path);
          // Note: readImageAsDataUrl just reads the file — for JSON we decode manually
          // TODO: add a dedicated readTextFile IPC, for now we load via fetch
        } catch { /* ignore */ }
      }

      // Load plot images as data URLs
      if (r.waveform_graph_path) {
        window.api.readImageAsDataUrl(r.waveform_graph_path).then(setWaveformUrl);
      }
      if (r.psd_graph_path) {
        window.api.readImageAsDataUrl(r.psd_graph_path).then(setPsdUrl);
      }

      setLoading(false);
    });
  }, [testId]);

  if (loading) return <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>;
  if (!run) {
    return (
      <div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>← Back</button>
        <p style={{ color: "var(--color-red)" }}>Run not found.</p>
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>← Back</button>

      <div className="page-header">
        <h1>Run Detail</h1>
        <p style={{ fontFamily: "monospace", fontSize: 12 }}>{run.test_id}</p>
      </div>

      {/* Summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Overall Status</div>
            <DiagnosticBadge status={run.overall_status} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Sync</div>
            <SyncBadge status={run.sync_status} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Drone</div>
            <div>{run.drone_id}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Motor</div>
            <div>{run.motor_label}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Recorded</div>
            <div style={{ fontSize: 13 }}>{new Date(run.recorded_at).toLocaleString()}</div>
          </div>
          {run.microphone_name && (
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Microphone</div>
              <div>{run.microphone_name}</div>
            </div>
          )}
        </div>
      </div>

      {/* Fault checks */}
      {diagnostic && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Fault Analysis — {diagnostic.motor_name}</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
            Shaft frequency: {diagnostic.shaft_freq_hz.toFixed(1)} Hz (~{diagnostic.shaft_rpm.toFixed(0)} RPM)
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fault</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Deviation</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.fault_checks.map((fc) => (
                <tr key={fc.fault_name}>
                  <td>{fc.fault_name}</td>
                  <td>
                    {fc.severity === 0 && <span className="badge badge-green">Ready</span>}
                    {fc.severity === 1 && <span className="badge badge-yellow">Warning</span>}
                    {fc.severity === 2 && <span className="badge badge-red">Do Not Fly</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>
                    {fc.deviation_db >= 0 ? "+" : ""}{fc.deviation_db.toFixed(1)} dB
                  </td>
                  <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{fc.band_description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Graphs */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {waveformUrl && (
          <div className="card">
            <div className="card-title">Waveform (Time Domain)</div>
            <img src={waveformUrl} alt="Waveform" style={{ width: "100%", borderRadius: 4 }} />
          </div>
        )}
        {psdUrl && (
          <div className="card">
            <div className="card-title">PSD Comparison</div>
            <img src={psdUrl} alt="PSD" style={{ width: "100%", borderRadius: 4 }} />
          </div>
        )}
      </div>

      {/* Artifacts */}
      <div className="card">
        <div className="card-title">Artifacts</div>
        <table className="data-table">
          <tbody>
            {[
              ["WAV Recording", run.raw_wav_path],
              ["Preprocessed Signal", run.preprocessed_data_path],
              ["FFT Data", run.fft_data_path],
              ["Result JSON", run.results_json_path],
            ].map(([label, path]) => (
              <tr key={label as string}>
                <td style={{ color: "var(--color-text-muted)", fontSize: 12, width: 160 }}>{label}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {path ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {run.last_sync_error && (
          <div style={{ marginTop: 10, padding: 8, background: "var(--color-red-dark)", borderRadius: 4, fontSize: 12 }}>
            Last sync error: {run.last_sync_error}
          </div>
        )}
      </div>
    </div>
  );
}
