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

    window.api.getDiagnosticRun(testId).then(async (record) => {
      setRun(record);
      if (!record) {
        setLoading(false);
        return;
      }

      if (record.results_json_path) {
        try {
          const text = await window.api.readTextFile(record.results_json_path);
          if (text) {
            const parsed = JSON.parse(text) as { diagnostic?: DiagnosticResult };
            if (parsed.diagnostic) setDiagnostic(parsed.diagnostic);
          }
        } catch {
          // ignore unreadable result file
        }
      }

      if (record.waveform_graph_path) {
        window.api.readImageAsDataUrl(record.waveform_graph_path).then(setWaveformUrl).catch(() => null);
      }
      if (record.psd_graph_path) {
        window.api.readImageAsDataUrl(record.psd_graph_path).then(setPsdUrl).catch(() => null);
      }

      setLoading(false);
    });
  }, [testId]);

  useEffect(() => {
    if (!testId) return;
    const unsub = window.api.onSyncStatusChange(({ testId: updatedId, status }) => {
      if (updatedId === testId) {
        setRun((prev) => (prev ? { ...prev, sync_status: status as DiagnosticRun["sync_status"] } : prev));
      }
    });
    return unsub;
  }, [testId]);

  if (loading) return <div className="helper-text">Loading run details...</div>;

  if (!run) {
    return (
      <div className="page">
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        <div className="error-banner">Run not found.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="section-label">Records</div>
          <h1 className="page-title">Run detail</h1>
          <p className="page-subtitle mono">{run.test_id}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="section-label">Summary</div>
            <div className="card-title">Diagnostic snapshot</div>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-item">
            <div className="subtle-label">Overall status</div>
            <div className="detail-value"><DiagnosticBadge status={run.overall_status} /></div>
          </div>
          <div className="detail-item">
            <div className="subtle-label">Sync</div>
            <div className="detail-value"><SyncBadge status={run.sync_status} /></div>
          </div>
          <div className="detail-item">
            <div className="subtle-label">Drone</div>
            <div className="detail-value">{run.drone_id}</div>
          </div>
          <div className="detail-item">
            <div className="subtle-label">Motor</div>
            <div className="detail-value">{run.motor_label}</div>
          </div>
          <div className="detail-item">
            <div className="subtle-label">Recorded</div>
            <div className="detail-value">{new Date(run.recorded_at).toLocaleString()}</div>
          </div>
        </div>
      </section>

      {diagnostic ? (
        <section className="card table-shell">
          <div className="card-header" style={{ padding: "22px 22px 0" }}>
            <div>
              <div className="section-label">Fault analysis</div>
              <div className="card-title">{diagnostic.motor_name}</div>
              <div className="card-subtitle">Shaft frequency {diagnostic.shaft_freq_hz.toFixed(1)} Hz · {diagnostic.shaft_rpm.toFixed(0)} RPM</div>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fault</th>
                <th>Status</th>
                <th>Deviation</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.fault_checks.map((check) => (
                <tr key={check.fault_name}>
                  <td>{check.fault_name}</td>
                  <td>
                    {check.severity === 0 && <span className="badge badge-green">Ready</span>}
                    {check.severity === 1 && <span className="badge badge-yellow">Warning</span>}
                    {check.severity === 2 && <span className="badge badge-red">Do Not Fly</span>}
                  </td>
                  <td className="mono">{check.deviation_db >= 0 ? "+" : ""}{check.deviation_db.toFixed(1)} dB</td>
                  <td>{check.band_description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : run.results_json_path ? (
        <section className="card">
          <div className="helper-text">Diagnostic data is unavailable. The result file may be missing or unreadable.</div>
        </section>
      ) : null}

      {(waveformUrl || psdUrl) && (
        <div className="grid-2">
          {waveformUrl && (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="section-label">Waveform</div>
                  <div className="card-title">Time domain view</div>
                </div>
              </div>
              <img src={waveformUrl} alt="Waveform" style={{ borderRadius: 10 }} />
            </section>
          )}
          {psdUrl && (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="section-label">PSD</div>
                  <div className="card-title">Frequency comparison</div>
                </div>
              </div>
              <img src={psdUrl} alt="PSD" style={{ borderRadius: 10 }} />
            </section>
          )}
        </div>
      )}

      <section className="card table-shell">
        <div className="card-header" style={{ padding: "22px 22px 0" }}>
          <div>
            <div className="section-label">Artifacts</div>
            <div className="card-title">Generated files</div>
          </div>
        </div>
        <table className="data-table">
          <tbody>
            {([
              ["WAV recording", run.raw_wav_path],
              ["Preprocessed signal", run.preprocessed_data_path],
              ["FFT data", run.fft_data_path],
              ["Result JSON", run.results_json_path],
            ] as [string, string | null][]).map(([label, filePath]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="mono">{filePath ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {run.last_sync_error && <div className="error-banner" style={{ margin: 18 }}>Last sync error: {run.last_sync_error}</div>}
      </section>
    </div>
  );
}
