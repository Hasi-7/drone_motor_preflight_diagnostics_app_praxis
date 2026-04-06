import React from "react";

interface EmergencyStopProps {
  onStop: () => void;
  disabled?: boolean;
}

export function EmergencyStop({ onStop, disabled }: EmergencyStopProps) {
  const handleClick = () => {
    if (disabled) return;
    onStop();
  };

  return (
    <button
      className="btn btn-emergency"
      onClick={handleClick}
      disabled={disabled}
      aria-label="Emergency stop — halt all motors immediately"
    >
      Emergency stop
    </button>
  );
}
