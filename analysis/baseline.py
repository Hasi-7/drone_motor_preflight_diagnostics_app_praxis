"""
Baseline management: save, load, and average baseline profiles.

Behavioral parity with sound_final_design_2.py::save_baseline / load_baseline.
Adds baseline averaging for the 5-run onboarding workflow.
"""
from pathlib import Path
from typing import Sequence

import numpy as np

from .models import BaselineData, SpectralData


def save_baseline(spectral: SpectralData, out_path: str | Path) -> Path:
    """Save a baseline spectral profile to a .npz file.

    Equivalent to save_baseline() in the legacy code.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(str(out_path), freqs=spectral.freqs, psd_db=spectral.psd_db)
    return out_path


def load_baseline(npz_path: str | Path) -> SpectralData:
    """Load a baseline spectral profile from a .npz file.

    Equivalent to load_baseline() in the legacy code.
    """
    npz_path = Path(npz_path)
    if not npz_path.exists():
        raise FileNotFoundError(f"Baseline file not found: {npz_path}")
    data = np.load(str(npz_path))
    return SpectralData(freqs=data["freqs"], psd_db=data["psd_db"])


def average_baselines(spectral_list: Sequence[SpectralData]) -> SpectralData:
    """Average multiple spectral profiles into a single baseline.

    Used for the 5-run baseline onboarding workflow. All inputs must share
    the same frequency axis (same nperseg and sample rate).

    Args:
        spectral_list: Sequence of SpectralData from healthy reference runs.
                       Minimum 1, recommended 5.

    Returns:
        A new SpectralData whose psd_db is the element-wise mean.

    Raises:
        ValueError: If the input list is empty or frequency axes differ.
    """
    if not spectral_list:
        raise ValueError("Cannot average an empty list of baselines.")

    ref_freqs = spectral_list[0].freqs
    for i, s in enumerate(spectral_list[1:], start=1):
        if len(s.freqs) != len(ref_freqs) or not np.allclose(s.freqs, ref_freqs):
            raise ValueError(
                f"Baseline {i} has a different frequency axis than baseline 0. "
                "All captures must use the same sample rate and nperseg."
            )

    stacked = np.stack([s.psd_db for s in spectral_list], axis=0)
    averaged_psd_db = np.mean(stacked, axis=0)
    return SpectralData(freqs=ref_freqs.copy(), psd_db=averaged_psd_db)


def save_baseline_profile(
    baseline: BaselineData,
    base_dir: str | Path,
) -> Path:
    """Save a named baseline profile (drone_id / throttle_preset).

    Saves to: <base_dir>/<drone_id>/<throttle_preset>/baseline.npz

    Returns the path of the saved file.
    """
    out_dir = Path(base_dir) / baseline.drone_id / baseline.throttle_preset
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "baseline.npz"
    np.savez(
        str(out_path),
        freqs=baseline.freqs,
        psd_db=baseline.psd_db,
        capture_count=np.array(baseline.capture_count),
    )
    return out_path


def load_baseline_profile(
    drone_id: str,
    throttle_preset: str,
    base_dir: str | Path,
) -> BaselineData:
    """Load a named baseline profile by drone_id and throttle_preset.

    Raises:
        FileNotFoundError: If no baseline exists for that drone/throttle.
    """
    npz_path = Path(base_dir) / drone_id / throttle_preset / "baseline.npz"
    if not npz_path.exists():
        raise FileNotFoundError(
            f"No baseline found for drone='{drone_id}', preset='{throttle_preset}' "
            f"at {npz_path}"
        )
    data = np.load(str(npz_path))
    return BaselineData(
        drone_id=drone_id,
        throttle_preset=throttle_preset,
        freqs=data["freqs"],
        psd_db=data["psd_db"],
        capture_count=int(data.get("capture_count", np.array(1))),
    )
