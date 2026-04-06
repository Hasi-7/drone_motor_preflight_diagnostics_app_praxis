import React from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { TestScreen } from "./pages/TestScreen";
import { BaselineScreen } from "./pages/BaselineScreen";
import { HistoryScreen } from "./pages/HistoryScreen";
import { RunDetailScreen } from "./pages/RunDetailScreen";
import { SettingsScreen } from "./pages/SettingsScreen";

export function App() {
  return (
    <HashRouter>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-logo">Motor Diagnostics</div>
          <div className="sidebar-nav">
            <NavLink to="/" end>
              <span>▶</span> Test
            </NavLink>
            <NavLink to="/baseline">
              <span>◈</span> Baseline
            </NavLink>
            <NavLink to="/history">
              <span>≡</span> History
            </NavLink>
            <NavLink to="/settings">
              <span>⚙</span> Settings
            </NavLink>
          </div>
        </nav>
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
    </HashRouter>
  );
}
