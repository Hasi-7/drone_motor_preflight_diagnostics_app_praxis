import React, { useState } from "react";

interface ThrottleWarningProps {
  throttleValue: number;
  safetyThreshold?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation gate shown when a preset throttle exceeds the safety threshold.
 * Operator must explicitly confirm that propellers are removed before proceeding.
 */
export function ThrottleWarningModal({
  throttleValue,
  safetyThreshold = 1200,
  onConfirm,
  onCancel,
}: ThrottleWarningProps) {
  const [confirmed, setConfirmed] = useState(false);

  if (throttleValue <= safetyThreshold) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div style={{ color: "var(--color-yellow)", fontSize: 32, textAlign: "center", marginBottom: 12 }}>
          ⚠
        </div>
        <h2 style={{ textAlign: "center", marginBottom: 8 }}>High Throttle Warning</h2>
        <p style={{ color: "var(--color-text-muted)", textAlign: "center", marginBottom: 16 }}>
          The selected throttle value ({throttleValue}) exceeds the safety threshold of {safetyThreshold}.
        </p>
        <div className="warning-banner" style={{ textAlign: "center" }}>
          PROPELLERS MUST BE REMOVED before running this test.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm that all propellers have been removed from this drone.</span>
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            style={{ flex: 1 }}
            onClick={onConfirm}
            disabled={!confirmed}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
}
