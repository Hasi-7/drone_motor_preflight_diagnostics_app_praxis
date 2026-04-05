import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DiagnosticBadge, SyncBadge } from "../components/StatusBadge";
import type { DiagnosticRun } from "../../shared/types";

export function HistoryScreen() {
  const [runs, setRuns] = useState<DiagnosticRun[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    window.api.getDiagnosticRuns(100, 0).then((data) => {
      setRuns(data);
      setLoading(false);
    });
  }, []);

  // Subscribe to sync updates
  useEffect(() => {
    const unsub = window.api.onSyncStatusChange(({ testId, status }) => {
      setRuns((prev) =>
        prev.map((r) =>
          r.test_id === testId ? { ...r, sync_status: status as DiagnosticRun["sync_status"] } : r
        )
      );
    });
    return unsub;
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1>History</h1></div>
        <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>History</h1>
        <p>{runs.length} diagnostic runs on this device.</p>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {runs.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-muted)" }}>
            No runs yet. Use the Test screen to run a diagnostic.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Test ID</th>
                <th>Drone</th>
                <th>Motor</th>
                <th>Preset</th>
                <th>Result</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.test_id} onClick={() => navigate(`/history/${run.test_id}`)}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {new Date(run.recorded_at).toLocaleString()}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)" }}>
                    {run.test_id.slice(0, 12)}…
                  </td>
                  <td>{run.drone_id}</td>
                  <td>{run.motor_label}</td>
                  <td style={{ fontSize: 12 }}>{run.throttle_preset_id}</td>
                  <td>
                    <DiagnosticBadge status={run.overall_status} />
                  </td>
                  <td>
                    <SyncBadge status={run.sync_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
