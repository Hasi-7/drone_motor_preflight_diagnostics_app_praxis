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
    <div className="modal-backdrop">
      <div className="card modal-card">
        <div className="modal-icon">!</div>
        <h2 className="modal-title">High throttle warning</h2>
        <p className="modal-copy">
          The selected throttle value ({throttleValue}) exceeds the safety threshold of {safetyThreshold}.
        </p>
        <div className="warning-banner" style={{ marginTop: 16, textAlign: "center" }}>
          PROPELLERS MUST BE REMOVED before running this test.
        </div>
        <label className="surface-muted" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm that all propellers have been removed from this drone.</span>
        </label>
        <div className="modal-actions">
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
