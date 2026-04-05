"""
Post-processing stage: fault checks and diagnostic classification.

Behavioral parity with sound_final_design_2.py:
  - status_from_deviation
  - check_imbalance
  - check_misalignment
  - check_bearing_inner
  - check_bearing_outer
  - check_shaft_crack
  - check_gear_fault
  - check_electrical_fault
  - check_general_degradation
  - run_all_checks

All thresholds and formulas are preserved exactly.
"""
import numpy as np

from .config import WARN_DB, CRIT_DB, MotorConfig
from .models import FaultCheckResult, DiagnosticResult, SpectralData
from .spectral import peak_db_near_raw, band_avg_db_raw


# ── Status helper ──────────────────────────────────────────────────────────

def status_from_deviation(deviation_db: float) -> tuple[str, str]:
    """Map a dB deviation to (label, icon).

    Thresholds from Randall Ch.4:
      WARN_DB (6 dB)  = minimum significant change
      CRIT_DB (12 dB) = serious fault (early critical warning)

    Preserved exactly from the legacy code.
    """
    if deviation_db >= CRIT_DB:
        return "DO NOT FLY", "[RED]"
    elif deviation_db >= WARN_DB:
        return "WARNING", "[YELLOW]"
    else:
        return "READY TO FLY", "[GREEN]"


# ── Individual fault checks ────────────────────────────────────────────────

def check_imbalance(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
) -> FaultCheckResult:
    """Fault 1 — Mass Imbalance.

    Compare peak dB at 1x shaft frequency vs baseline.
    Randall p.22: unbalance produces sinusoidal forcing at 1x shaft speed.
    """
    test_peak = peak_db_near_raw(test.freqs, test.psd_db, shaft_freq)
    bl_peak = peak_db_near_raw(baseline.freqs, baseline.psd_db, shaft_freq)
    deviation = test_peak - bl_peak
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Imbalance",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"1x shaft ({shaft_freq:.1f} Hz)",
    )


def check_misalignment(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
) -> FaultCheckResult:
    """Fault 2 — Misalignment.

    Check deviation at 2x and 4x shaft harmonics.
    Randall p.152: misalignment characteristically excites 2nd and 4th harmonics.
    """
    deviations = []
    for harmonic in [2, 4]:
        f_target = harmonic * shaft_freq
        test_peak = peak_db_near_raw(test.freqs, test.psd_db, f_target)
        bl_peak = peak_db_near_raw(baseline.freqs, baseline.psd_db, f_target)
        deviations.append(test_peak - bl_peak)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Misalignment",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"2x/4x harmonics ({2*shaft_freq:.1f}/{4*shaft_freq:.1f} Hz)",
    )


def check_bearing_inner(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
    motor_config: MotorConfig,
) -> FaultCheckResult:
    """Fault 3 — Bearing Inner Race (BPFI).

    Check band energy around BPFI and its first 3 harmonics.
    Randall Section 5.5 p.195: BPFI appears at high frequency with sidebands.
    """
    bpfi = motor_config.bpfi_ratio * shaft_freq
    deviations = []
    for n in [1, 2, 3]:
        f_target = n * bpfi
        bw = 0.1 * f_target  # 10% bandwidth around each harmonic
        test_band = band_avg_db_raw(test.freqs, test.psd_db, f_target - bw, f_target + bw)
        bl_band = band_avg_db_raw(baseline.freqs, baseline.psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Bearing Inner Race",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"BPFI band ({bpfi:.1f} Hz and harmonics)",
    )


def check_bearing_outer(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
    motor_config: MotorConfig,
) -> FaultCheckResult:
    """Fault 4 — Bearing Outer Race (BPFO).

    Check band energy around BPFO and its first 3 harmonics.
    Randall p.205: outer race fault produces clean BPFO harmonics.
    """
    bpfo = motor_config.bpfo_ratio * shaft_freq
    deviations = []
    for n in [1, 2, 3]:
        f_target = n * bpfo
        bw = 0.1 * f_target
        test_band = band_avg_db_raw(test.freqs, test.psd_db, f_target - bw, f_target + bw)
        bl_band = band_avg_db_raw(baseline.freqs, baseline.psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Bearing Outer Race",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"BPFO band ({bpfo:.1f} Hz and harmonics)",
    )


def check_shaft_crack(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
) -> FaultCheckResult:
    """Fault 5 — Shaft Crack (Breathing Crack).

    Detect appearance/growth of odd shaft harmonics (3x, 5x).
    Randall p.22: breathing cracks generate odd harmonics.
    Healthy motor has very low energy at these frequencies.
    """
    deviations = []
    for harmonic in [3, 5]:
        f_target = harmonic * shaft_freq
        test_peak = peak_db_near_raw(test.freqs, test.psd_db, f_target)
        bl_peak = peak_db_near_raw(baseline.freqs, baseline.psd_db, f_target)
        deviations.append(test_peak - bl_peak)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Shaft Crack",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"Odd harmonics 3x/5x ({3*shaft_freq:.1f}/{5*shaft_freq:.1f} Hz)",
    )


def check_gear_fault(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
    motor_config: MotorConfig,
) -> FaultCheckResult:
    """Fault 6 — Gear Tooth Fault.

    Check sideband energy around gearmesh frequency (1x and 2x).
    Randall p.153: localized gear faults produce widely distributed sidebands
    spaced at shaft speed around toothmesh harmonics.
    """
    f_mesh = motor_config.n_rotor_slots * shaft_freq
    deviations = []
    for n in [1, 2]:
        f_target = n * f_mesh
        bw = 3 * shaft_freq  # ±3 shaft-freq wide band to capture sideband spread
        test_band = band_avg_db_raw(test.freqs, test.psd_db, f_target - bw, f_target + bw)
        bl_band = band_avg_db_raw(baseline.freqs, baseline.psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Gear Tooth Fault",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"Gearmesh band ({f_mesh:.1f} Hz +/-sidebands)",
    )


def check_electrical_fault(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
    motor_config: MotorConfig,
) -> FaultCheckResult:
    """Fault 7 — Electrical Fault (Rotor/Stator Eccentricity).

    Check sideband energy around slot-pass frequency, spaced at pole-pass frequency.
    Randall p.148: electrical faults show as sidebands around slot-pass frequencies.
    """
    f_slot = motor_config.n_rotor_slots * shaft_freq
    f_pole_pass = motor_config.n_poles * shaft_freq
    deviations = []
    for offset in [-f_pole_pass, f_pole_pass, -2 * f_pole_pass, 2 * f_pole_pass]:
        f_target = f_slot + offset
        if f_target > 0:
            test_peak = peak_db_near_raw(test.freqs, test.psd_db, f_target)
            bl_peak = peak_db_near_raw(baseline.freqs, baseline.psd_db, f_target)
            deviations.append(test_peak - bl_peak)
    deviation = max(deviations) if deviations else 0.0
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="Electrical Fault",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description=f"Slot-pass sidebands ({f_slot:.1f} Hz +/- pole-pass)",
    )


def check_general_degradation(
    test: SpectralData,
    baseline: SpectralData,
) -> FaultCheckResult:
    """Fault 8 — General Mechanical Degradation.

    Compare mean noise floor across the full spectrum.
    Randall Section 4.2.2: broad spectral floor lift indicates general mechanical
    wear even before discrete peaks appear.

    Baseline is interpolated onto the test frequency axis for fair comparison.
    Uses the mean of positive deviations (ignores local dips).
    """
    bl_interp = np.interp(test.freqs, baseline.freqs, baseline.psd_db)
    diff = test.psd_db - bl_interp
    positive_diffs = diff[diff > 0]
    deviation = float(np.mean(positive_diffs)) if len(positive_diffs) > 0 else 0.0
    label, icon = status_from_deviation(deviation)
    return FaultCheckResult(
        fault_name="General Degradation",
        label=label,
        icon=icon,
        deviation_db=deviation,
        band_description="Broadband noise floor (full spectrum)",
    )


# ── Run all 8 checks ───────────────────────────────────────────────────────

def run_all_checks(
    test: SpectralData,
    baseline: SpectralData,
    shaft_freq: float,
    motor_config: MotorConfig,
    motor_name: str = "Motor",
) -> DiagnosticResult:
    """Run all 8 fault checks and compute the overall classification.

    Equivalent to run_all_checks() in the legacy code, but returns a typed
    DiagnosticResult instead of a dictionary.
    """
    fault_checks = [
        check_imbalance(test, baseline, shaft_freq),
        check_misalignment(test, baseline, shaft_freq),
        check_bearing_inner(test, baseline, shaft_freq, motor_config),
        check_bearing_outer(test, baseline, shaft_freq, motor_config),
        check_shaft_crack(test, baseline, shaft_freq),
        check_gear_fault(test, baseline, shaft_freq, motor_config),
        check_electrical_fault(test, baseline, shaft_freq, motor_config),
        check_general_degradation(test, baseline),
    ]

    max_severity = max(fc.severity for fc in fault_checks)
    if max_severity == 2:
        overall_status = "DO NOT FLY"
        overall_icon = "[RED]"
    elif max_severity == 1:
        overall_status = "WARNING"
        overall_icon = "[YELLOW]"
    else:
        overall_status = "READY TO FLY"
        overall_icon = "[GREEN]"

    return DiagnosticResult(
        motor_name=motor_name,
        shaft_freq_hz=shaft_freq,
        fault_checks=fault_checks,
        overall_status=overall_status,
        overall_icon=overall_icon,
    )
