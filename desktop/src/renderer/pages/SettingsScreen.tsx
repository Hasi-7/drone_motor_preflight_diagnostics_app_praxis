import React, { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
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

  if (loading) return <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Configure Supabase sync, storage, safety thresholds, and microphone defaults.</p>
      </div>

      {/* Supabase */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Supabase Sync</div>
        <div className="form-group">
          <label className="form-label">Supabase Project URL</label>
          <input className="form-input" placeholder="https://xyz.supabase.co"
            value={settings.supabaseUrl}
            onChange={(e) => update("supabaseUrl", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Supabase Anon Key</label>
          <input className="form-input" type="password" placeholder="eyJ..."
            value={settings.supabaseAnonKey}
            onChange={(e) => update("supabaseAnonKey", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={settings.autoSyncEnabled}
              onChange={(e) => update("autoSyncEnabled", e.target.checked)} />
            Enable automatic background sync
          </label>
        </div>
      </div>

      {/* Storage */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Local Storage</div>
        <div className="form-group">
          <label className="form-label">Data Directory</label>
          <input className="form-input" placeholder="Leave blank to use default app data folder"
            value={settings.localStoragePath}
            onChange={(e) => update("localStoragePath", e.target.value)} />
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
            WAV recordings, analysis results, and plots are stored here.
          </div>
        </div>
      </div>

      {/* Safety */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Safety</div>
        <div className="form-group">
          <label className="form-label">Throttle Safety Threshold (Betaflight 1000–2000 scale)</label>
          <input className="form-input" type="number" min={1000} max={1999} step={50}
            value={settings.throttleSafetyThreshold}
            onChange={(e) => update("throttleSafetyThreshold", Number(e.target.value))} />
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
            Presets above this value will require an explicit prop-removal confirmation. Default: 1200.
          </div>
        </div>
      </div>

      {/* Microphone */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Audio</div>
        <div className="form-group">
          <label className="form-label">Default Microphone Name</label>
          <input className="form-input" placeholder="Leave blank to use system default"
            value={settings.defaultMicName}
            onChange={(e) => update("defaultMicName", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          Save Settings
        </button>
        {saved && <span style={{ color: "var(--color-green)", fontSize: 13 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
