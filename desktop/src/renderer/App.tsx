import React from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { TestScreen } from "./pages/TestScreen";
import { BaselineScreen } from "./pages/BaselineScreen";
import { HistoryScreen } from "./pages/HistoryScreen";
import { RunDetailScreen } from "./pages/RunDetailScreen";
import { SettingsScreen } from "./pages/SettingsScreen";

const NAV_ITEMS = [
  { to: "/", label: "Test", eyebrow: "Operations", icon: "T" },
  { to: "/baseline", label: "Baseline Setup", eyebrow: "Calibration", icon: "B" },
  { to: "/history", label: "History", eyebrow: "Records", icon: "H" },
  { to: "/settings", label: "Settings", eyebrow: "System", icon: "S" },
];

function AppShell() {
  const location = useLocation();
  const activeItem = NAV_ITEMS.find((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
  ) ?? NAV_ITEMS[0];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">DM</div>
          <div>
            <div className="sidebar-section-label">Drone Motor</div>
            <div className="sidebar-title">Diagnostics</div>
          </div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-section-label">Workspace</div>
          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"}>
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-copy">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-meta">{item.eyebrow}</span>
                </span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-section-label">Status</div>
          <div className="sidebar-status-card">
            <span className="status-dot success" />
            <div>
              <div className="sidebar-status-title">Desktop workstation</div>
              <div className="sidebar-status-meta">Ready for local diagnostics</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="app-main-column">
        <header className="topbar">
          <div>
            <div className="topbar-label">{activeItem.eyebrow}</div>
            <div className="topbar-title">{activeItem.label}</div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-chip">
              <span className="status-dot" />
              Local control online
            </div>
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<TestScreen />} />
            <Route path="/baseline" element={<BaselineScreen />} />
            <Route path="/history" element={<HistoryScreen />} />
            <Route path="/history/:testId" element={<RunDetailScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
