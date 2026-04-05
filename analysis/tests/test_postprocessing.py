"""Tests for analysis.postprocessing — fault checks and classification."""
import numpy as np
import pytest

from analysis.config import WARN_DB, CRIT_DB, MotorConfig
from analysis.models import SpectralData, DiagnosticResult, FaultCheckResult
from analysis.postprocessing import (
    check_bearing_inner,
    check_bearing_outer,
    check_electrical_fault,
    check_gear_fault,
    check_general_degradation,
    check_imbalance,
    check_misalignment,
    check_shaft_crack,
    run_all_checks,
    status_from_deviation,
)


def _flat_spectral(n: int = 512, value: float = -60.0) -> SpectralData:
    """Flat PSD — used as baseline or healthy test signal."""
    freqs = np.linspace(0, 22050, n)
    psd_db = np.full(n, value)
    return SpectralData(freqs=freqs, psd_db=psd_db)


def _spectral_with_spike(
    spike_freq: float,
    spike_db: float = -30.0,
    base_db: float = -60.0,
    n: int = 2048,
    sr: float = 44100.0,
) -> SpectralData:
    """Flat PSD with a spike at spike_freq."""
    freqs = np.linspace(0, sr / 2, n)
    psd_db = np.full(n, base_db)
    idx = np.argmin(np.abs(freqs - spike_freq))
    psd_db[idx] = spike_db
    return SpectralData(freqs=freqs, psd_db=psd_db)


class TestStatusFromDeviation:
    def test_ok(self):
        label, icon = status_from_deviation(0.0)
        assert label == "READY TO FLY"
        assert icon == "[GREEN]"

    def test_warn_boundary(self):
        label, icon = status_from_deviation(WARN_DB)
        assert label == "WARNING"
        assert icon == "[YELLOW]"

    def test_crit_boundary(self):
        label, icon = status_from_deviation(CRIT_DB)
        assert label == "DO NOT FLY"
        assert icon == "[RED]"

    def test_below_warn(self):
        label, _ = status_from_deviation(WARN_DB - 0.1)
        assert label == "READY TO FLY"

    def test_above_warn_below_crit(self):
        label, _ = status_from_deviation((WARN_DB + CRIT_DB) / 2)
        assert label == "WARNING"


class TestFaultCheckResults:
    """Verify fault checks return FaultCheckResult with correct fields."""

    def setup_method(self):
        self.cfg = MotorConfig()
        self.shaft_freq = 200.0
        self.baseline = _flat_spectral()

    def _check_is_fault_check_result(self, result):
        assert isinstance(result, FaultCheckResult)
        assert result.label in {"READY TO FLY", "WARNING", "DO NOT FLY"}
        assert result.icon in {"[GREEN]", "[YELLOW]", "[RED]"}
        assert isinstance(result.deviation_db, float)
        assert isinstance(result.band_description, str)

    def test_imbalance_healthy(self):
        result = check_imbalance(self.baseline, self.baseline, self.shaft_freq)
        self._check_is_fault_check_result(result)
        assert result.label == "READY TO FLY"
        assert result.deviation_db == pytest.approx(0.0)

    def test_imbalance_detects_spike(self):
        test = _spectral_with_spike(self.shaft_freq, spike_db=-40.0, base_db=-80.0)
        baseline = _spectral_with_spike(self.shaft_freq, spike_db=-60.0, base_db=-80.0)
        result = check_imbalance(test, baseline, self.shaft_freq)
        assert result.deviation_db == pytest.approx(20.0, abs=2.0)
        assert result.label == "DO NOT FLY"

    def test_misalignment_healthy(self):
        result = check_misalignment(self.baseline, self.baseline, self.shaft_freq)
        assert result.label == "READY TO FLY"

    def test_bearing_inner_healthy(self):
        result = check_bearing_inner(self.baseline, self.baseline, self.shaft_freq, self.cfg)
        assert result.label == "READY TO FLY"

    def test_bearing_outer_healthy(self):
        result = check_bearing_outer(self.baseline, self.baseline, self.shaft_freq, self.cfg)
        assert result.label == "READY TO FLY"

    def test_shaft_crack_healthy(self):
        result = check_shaft_crack(self.baseline, self.baseline, self.shaft_freq)
        assert result.label == "READY TO FLY"

    def test_gear_fault_healthy(self):
        result = check_gear_fault(self.baseline, self.baseline, self.shaft_freq, self.cfg)
        assert result.label == "READY TO FLY"

    def test_electrical_fault_healthy(self):
        result = check_electrical_fault(self.baseline, self.baseline, self.shaft_freq, self.cfg)
        assert result.label == "READY TO FLY"

    def test_general_degradation_healthy(self):
        result = check_general_degradation(self.baseline, self.baseline)
        assert result.deviation_db == pytest.approx(0.0)
        assert result.label == "READY TO FLY"

    def test_general_degradation_raised_floor(self):
        test = _flat_spectral(value=-40.0)       # 20 dB above baseline
        baseline = _flat_spectral(value=-60.0)
        result = check_general_degradation(test, baseline)
        assert result.deviation_db == pytest.approx(20.0, abs=1.0)
        assert result.label == "DO NOT FLY"


class TestRunAllChecks:
    def test_returns_diagnostic_result(self):
        baseline = _flat_spectral()
        result = run_all_checks(
            test=baseline,
            baseline=baseline,
            shaft_freq=200.0,
            motor_config=MotorConfig(),
            motor_name="Motor 1",
        )
        assert isinstance(result, DiagnosticResult)
        assert result.motor_name == "Motor 1"
        assert len(result.fault_checks) == 8
        assert result.overall_status == "READY TO FLY"

    def test_overall_status_is_worst_fault(self):
        """Overall status should escalate if any check returns WARNING."""
        baseline = _flat_spectral(value=-80.0)
        # Raise the floor slightly above WARN_DB
        test = _flat_spectral(value=-80.0 + WARN_DB + 1.0)
        result = run_all_checks(
            test=test,
            baseline=baseline,
            shaft_freq=200.0,
            motor_config=MotorConfig(),
        )
        assert result.overall_status in {"WARNING", "DO NOT FLY"}

    def test_severity_property(self):
        fc_ok = FaultCheckResult("F", "READY TO FLY", "[GREEN]", 0.0, "")
        fc_warn = FaultCheckResult("F", "WARNING", "[YELLOW]", 7.0, "")
        fc_crit = FaultCheckResult("F", "DO NOT FLY", "[RED]", 15.0, "")
        assert fc_ok.severity == 0
        assert fc_warn.severity == 1
        assert fc_crit.severity == 2
