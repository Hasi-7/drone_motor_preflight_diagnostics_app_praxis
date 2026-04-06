import React, { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.getSettings().then((state) => {
      setSettings(state);
      setLoading(false);
    });
  }, []);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    await window.api.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="helper-text">Loading settings...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="section-label">System</div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure sync, storage, safety defaults, and microphone preferences without leaving the desktop workflow.</p>
        </div>
      </div>

      <div className="card-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Supabase sync</div>
              <div className="card-title">Cloud connection</div>
            </div>
          </div>

          <div className="stack-lg">
            <div className="form-group">
              <label className="form-label">Supabase project URL</label>
              <input className="field-input" placeholder="https://xyz.supabase.co" value={settings.supabaseUrl} onChange={(e) => update("supabaseUrl", e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Supabase anon key</label>
              <input className="field-input" type="password" placeholder="eyJ..." value={settings.supabaseAnonKey} onChange={(e) => update("supabaseAnonKey", e.target.value)} />
            </div>

            <label className="toggle-row">
              <div>
                <div className="form-label">Enable automatic background sync</div>
                <div className="form-hint">Queue uploads and retry completed runs when the device is online.</div>
              </div>
              <span className={`toggle ${settings.autoSyncEnabled ? "is-on" : ""}`}>
                <input className="toggle-input" type="checkbox" checked={settings.autoSyncEnabled} onChange={(e) => update("autoSyncEnabled", e.target.checked)} />
              </span>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Local storage</div>
              <div className="card-title">Workspace location</div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Data directory</label>
            <input className="field-input" placeholder="Leave blank to use the default app data folder" value={settings.localStoragePath} onChange={(e) => update("localStoragePath", e.target.value)} />
            <div className="helper-text">WAV recordings, analysis results, and generated plots are stored here.</div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Safety</div>
              <div className="card-title">Operational guardrails</div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Throttle safety threshold</label>
            <input className="field-input" type="number" min={1000} max={1999} step={50} value={settings.throttleSafetyThreshold} onChange={(e) => update("throttleSafetyThreshold", Number(e.target.value))} />
            <div className="helper-text">Presets above this Betaflight-scale value require explicit prop-removal confirmation. Default: 1200.</div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-label">Audio</div>
              <div className="card-title">Capture defaults</div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Default microphone name</label>
            <input className="field-input" placeholder="Leave blank to use the system default microphone" value={settings.defaultMicName} onChange={(e) => update("defaultMicName", e.target.value)} />
          </div>
        </section>
      </div>

      <div className="page-actions">
        <button className="btn btn-primary" onClick={handleSave}>Save settings</button>
        {saved && <span className="helper-text" style={{ color: "var(--green)" }}>Saved</span>}
      </div>
    </div>
  );
}
