import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SelectField } from "../components/SelectField";
import { DiagnosticBadge, SyncBadge } from "../components/StatusBadge";
import type { DiagnosticRun } from "../../shared/types";

export function HistoryScreen() {
  const [runs, setRuns] = useState<DiagnosticRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileFilter, setProfileFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    window.api.getDiagnosticRuns(100, 0).then((data) => {
      setRuns(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const unsub = window.api.onSyncStatusChange(({ testId, status }) => {
      setRuns((prev) => prev.map((run) => (run.test_id === testId ? { ...run, sync_status: status as DiagnosticRun["sync_status"] } : run)));
    });
    return unsub;
  }, []);

  const droneProfiles = useMemo(() => Array.from(new Set(runs.map((run) => run.drone_id))).sort(), [runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (profileFilter !== "all" && run.drone_id !== profileFilter) return false;
      if (resultFilter !== "all" && (run.overall_status ?? "unknown") !== resultFilter) return false;

      const runDate = new Date(run.recorded_at);
      if (startDate) {
        const start = new Date(`${startDate}T00:00:00`);
        if (runDate < start) return false;
      }
      if (endDate) {
        const end = new Date(`${endDate}T23:59:59`);
        if (runDate > end) return false;
      }
      return true;
    });
  }, [runs, profileFilter, resultFilter, startDate, endDate]);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <div className="section-label">Records</div>
            <h1 className="page-title">History</h1>
          </div>
        </div>
        <div className="helper-text">Loading diagnostic history...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="section-label">Records</div>
          <h1 className="page-title">History</h1>
          <p className="page-subtitle">Review local diagnostic runs, filter by result or time window, and jump into a detailed artifact view.</p>
        </div>
      </div>

      {runs.length === 0 ? (
        <section className="card empty-state">
          <div>
            <div className="empty-state-icon">H</div>
            <div className="empty-state-title">No diagnostic runs yet</div>
            <div className="empty-state-copy">Start a motor test to build your local run history. Completed sessions will appear here with status and sync metadata.</div>
            <div style={{ marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={() => navigate("/")}>Go to test page</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-header">
              <div>
                <div className="section-label">Filters</div>
                <div className="card-title">Refine results</div>
              </div>
            </div>
            <div className="filter-bar">
              <div className="form-group">
                <label className="form-label">Drone profile</label>
                <SelectField
                  value={profileFilter}
                  onChange={setProfileFilter}
                  options={[
                    { value: "all", label: "All profiles" },
                    ...droneProfiles.map((profile) => ({ value: profile, label: profile })),
                  ]}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Result</label>
                <SelectField
                  value={resultFilter}
                  onChange={setResultFilter}
                  options={[
                    { value: "all", label: "All results" },
                    { value: "READY TO FLY", label: "Ready to Fly" },
                    { value: "WARNING", label: "Warning" },
                    { value: "DO NOT FLY", label: "Do Not Fly" },
                    { value: "unknown", label: "Unknown" },
                  ]}
                />
              </div>

              <div className="form-group">
                <label className="form-label">From</label>
                <input className="field-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">To</label>
                <input className="field-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </section>

          <section className="card table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Drone profile</th>
                  <th>Throttle preset</th>
                  <th>Motor / mode</th>
                  <th>Result</th>
                  <th>Sync</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.test_id} onClick={() => navigate(`/history/${run.test_id}`)} style={{ cursor: "pointer" }}>
                    <td>
                      <div>{new Date(run.recorded_at).toLocaleDateString()}</div>
                      <div className="mono">{new Date(run.recorded_at).toLocaleTimeString()}</div>
                    </td>
                    <td>
                      <div>{run.drone_id}</div>
                      <div className="mono">{run.test_id.slice(0, 12)}...</div>
                    </td>
                    <td>{run.throttle_preset_id}</td>
                    <td>
                      <div>{run.motor_label}</div>
                      <div className="mono">{run.run_mode.replace("_", " ")}</div>
                    </td>
                    <td><DiagnosticBadge status={run.overall_status} /></td>
                    <td><SyncBadge status={run.sync_status} /></td>
                    <td><span className="row-action">View</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRuns.length === 0 && (
              <div className="empty-state" style={{ minHeight: 220 }}>
                <div>
                  <div className="empty-state-title">No runs match these filters</div>
                  <div className="empty-state-copy">Try broadening the date range or resetting the profile and result filters.</div>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
