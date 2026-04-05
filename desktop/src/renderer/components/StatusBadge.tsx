import React from "react";
import type { DiagnosticStatus, SyncStatus } from "../../shared/types";

interface DiagnosticBadgeProps {
  status: DiagnosticStatus | null | undefined;
}

export function DiagnosticBadge({ status }: DiagnosticBadgeProps) {
  if (!status) return <span className="badge badge-grey">Unknown</span>;
  if (status === "READY TO FLY") return <span className="badge badge-green">✓ Ready to Fly</span>;
  if (status === "WARNING") return <span className="badge badge-yellow">⚠ Warning</span>;
  return <span className="badge badge-red">✕ Do Not Fly</span>;
}

interface SyncBadgeProps {
  status: SyncStatus;
}

export function SyncBadge({ status }: SyncBadgeProps) {
  const map: Record<SyncStatus, [string, string]> = {
    pending: ["badge-grey", "Pending"],
    syncing: ["badge-grey", "Syncing…"],
    synced: ["badge-green", "Synced"],
    error: ["badge-red", "Sync Error"],
  };
  const [cls, label] = map[status] ?? ["badge-grey", status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
