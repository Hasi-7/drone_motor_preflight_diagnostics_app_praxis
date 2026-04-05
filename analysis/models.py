"""
Typed data models for the diagnostic analysis pipeline.

Replaces the loose dictionaries and tuple returns from the legacy code with
structured, typed dataclasses. All legacy fields are preserved.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import numpy as np


# ── Spectral / signal data ─────────────────────────────────────────────────

@dataclass
class PreprocessedData:
    """Output of the preprocessing stage."""
    segment: np.ndarray      # float32 audio samples
    sample_rate: int
    start_s: float           # trim start in seconds
    end_s: float             # trim end in seconds


@dataclass
class SpectralData:
    """Output of the spectral analysis stage."""
    freqs: np.ndarray        # frequency axis (Hz)
    psd_db: np.ndarray       # Welch PSD in dB


# ── Fault check results ────────────────────────────────────────────────────

@dataclass
class FaultCheckResult:
    """Result of one fault check function."""
    fault_name: str
    label: str               # "READY TO FLY" | "WARNING" | "DO NOT FLY"
    icon: str                # "[GREEN]" | "[YELLOW]" | "[RED]"
    deviation_db: float
    band_description: str

    @property
    def severity(self) -> int:
        """Numeric severity: 0 = OK, 1 = WARNING, 2 = CRITICAL."""
        if self.label == "DO NOT FLY":
            return 2
        if self.label == "WARNING":
            return 1
        return 0

    def to_dict(self) -> dict:
        return {
            "fault_name": self.fault_name,
            "label": self.label,
            "icon": self.icon,
            "deviation_db": round(self.deviation_db, 3),
            "band_description": self.band_description,
            "severity": self.severity,
        }


# ── Full diagnostic result ─────────────────────────────────────────────────

@dataclass
class DiagnosticResult:
    """Aggregated result for one motor run."""
    motor_name: str
    shaft_freq_hz: float
    fault_checks: list[FaultCheckResult]
    overall_status: str      # "READY TO FLY" | "WARNING" | "DO NOT FLY"
    overall_icon: str        # "[GREEN]" | "[YELLOW]" | "[RED]"

    def to_dict(self) -> dict:
        return {
            "motor_name": self.motor_name,
            "shaft_freq_hz": round(self.shaft_freq_hz, 2),
            "shaft_rpm": round(self.shaft_freq_hz * 60, 0),
            "overall_status": self.overall_status,
            "overall_icon": self.overall_icon,
            "fault_checks": [fc.to_dict() for fc in self.fault_checks],
        }


# ── Artifact paths ─────────────────────────────────────────────────────────

@dataclass
class RunArtifacts:
    """Filesystem paths for all artifacts produced by one run."""
    test_id: str
    output_dir: Path
    waveform_png_path: Optional[Path] = None
    psd_png_path: Optional[Path] = None
    preprocessed_npz_path: Optional[Path] = None
    fft_npz_path: Optional[Path] = None
    result_json_path: Optional[Path] = None

    def to_dict(self) -> dict:
        def _str(p: Optional[Path]) -> Optional[str]:
            return str(p) if p else None
        return {
            "test_id": self.test_id,
            "output_dir": str(self.output_dir),
            "waveform_png": _str(self.waveform_png_path),
            "psd_png": _str(self.psd_png_path),
            "preprocessed_npz": _str(self.preprocessed_npz_path),
            "fft_npz": _str(self.fft_npz_path),
            "result_json": _str(self.result_json_path),
        }


# ── Baseline data ──────────────────────────────────────────────────────────

@dataclass
class BaselineData:
    """A stored baseline profile (one drone + one throttle preset)."""
    drone_id: str
    throttle_preset: str
    freqs: np.ndarray
    psd_db: np.ndarray
    capture_count: int = 1

    def to_spectral(self) -> SpectralData:
        return SpectralData(freqs=self.freqs, psd_db=self.psd_db)
