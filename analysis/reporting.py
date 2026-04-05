"""
Reporting: human-readable text reports and structured JSON output.

Behavioral parity with sound_final_design_2.py::print_report.
Adds JSON export for the sidecar API contract.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import DiagnosticResult, RunArtifacts


_SEP = "=" * 60
_DASH = "-" * 60


def format_report(result: DiagnosticResult) -> str:
    """Return a formatted fault report string for one motor.

    Equivalent to print_report() in the legacy code, but returns a string
    instead of printing directly, so callers can log or display it.
    """
    lines = [
        "",
        _SEP,
        f"  FAULT REPORT — {result.motor_name}",
        f"  Detected shaft frequency: {result.shaft_freq_hz:.1f} Hz  "
        f"(~{result.shaft_freq_hz * 60:.0f} RPM)",
        _SEP,
        f"  {'Fault':<30} {'Status':<16} {'Deviation':>10}  {'Band'}",
        f"  {'-' * 56}",
    ]

    for fc in result.fault_checks:
        status_col = f"{fc.icon} {fc.label}"
        lines.append(
            f"  {fc.fault_name:<30} {status_col:<16} "
            f"{fc.deviation_db:>+8.1f} dB  {fc.band_description}"
        )

    lines += [
        _DASH,
        f"  OVERALL STATUS: {result.overall_icon} {result.overall_status}",
        _SEP,
        "",
    ]
    return "\n".join(lines)


def print_report(result: DiagnosticResult) -> None:
    """Print the formatted fault report to stdout.

    Thin wrapper around format_report for CLI use.
    """
    print(format_report(result))


def build_result_json(
    result: DiagnosticResult,
    artifacts: RunArtifacts,
    test_id: str,
    drone_id: Optional[str] = None,
    throttle_preset: Optional[str] = None,
    microphone_name: Optional[str] = None,
    app_version: Optional[str] = None,
    analysis_version: Optional[str] = None,
) -> dict:
    """Build the structured JSON result document for one run."""
    return {
        "schema_version": "1",
        "test_id": test_id,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "drone_id": drone_id,
        "throttle_preset": throttle_preset,
        "microphone_name": microphone_name,
        "app_version": app_version,
        "analysis_version": analysis_version,
        "diagnostic": result.to_dict(),
        "artifacts": artifacts.to_dict(),
    }


def save_result_json(
    result: DiagnosticResult,
    artifacts: RunArtifacts,
    test_id: str,
    out_path: str | Path,
    **kwargs,
) -> Path:
    """Serialize the result to a JSON file and return the path."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_result_json(result, artifacts, test_id, **kwargs)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path
