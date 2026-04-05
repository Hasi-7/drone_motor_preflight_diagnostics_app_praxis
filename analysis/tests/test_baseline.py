"""Tests for analysis.baseline — save/load/average baseline profiles."""
import numpy as np
import pytest

from analysis.baseline import (
    average_baselines,
    load_baseline,
    load_baseline_profile,
    save_baseline,
    save_baseline_profile,
)
from analysis.models import BaselineData, SpectralData


def _make_spectral(value: float = -60.0, n: int = 256) -> SpectralData:
    freqs = np.linspace(0, 22050, n)
    psd_db = np.full(n, value)
    return SpectralData(freqs=freqs, psd_db=psd_db)


class TestSaveLoadBaseline:
    def test_roundtrip(self, tmp_path):
        spectral = _make_spectral(-55.0)
        path = save_baseline(spectral, tmp_path / "baseline.npz")
        loaded = load_baseline(path)
        np.testing.assert_array_almost_equal(loaded.freqs, spectral.freqs)
        np.testing.assert_array_almost_equal(loaded.psd_db, spectral.psd_db)

    def test_creates_parent_dirs(self, tmp_path):
        spectral = _make_spectral()
        path = save_baseline(spectral, tmp_path / "nested" / "dir" / "bl.npz")
        assert path.exists()

    def test_load_missing_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_baseline(tmp_path / "does_not_exist.npz")


class TestAverageBaselines:
    def test_average_identical(self):
        spectral = _make_spectral(-60.0)
        result = average_baselines([spectral, spectral, spectral])
        np.testing.assert_array_almost_equal(result.psd_db, spectral.psd_db)

    def test_average_values(self):
        s1 = _make_spectral(-40.0)
        s2 = _make_spectral(-60.0)
        result = average_baselines([s1, s2])
        expected = np.full(256, -50.0)
        np.testing.assert_array_almost_equal(result.psd_db, expected)

    def test_five_run_average(self):
        """Confirm a 5-run average matches numpy mean."""
        values = [-55.0, -58.0, -62.0, -57.0, -60.0]
        spectrals = [_make_spectral(v) for v in values]
        result = average_baselines(spectrals)
        expected = np.mean(values)
        assert result.psd_db[0] == pytest.approx(expected)

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            average_baselines([])

    def test_mismatched_freqs_raises(self):
        s1 = _make_spectral(n=256)
        s2 = _make_spectral(n=512)
        with pytest.raises(ValueError, match="frequency axis"):
            average_baselines([s1, s2])


class TestBaselineProfile:
    def test_save_load_profile(self, tmp_path):
        spectral = _make_spectral(-60.0)
        baseline = BaselineData(
            drone_id="drone-001",
            throttle_preset="1100",
            freqs=spectral.freqs,
            psd_db=spectral.psd_db,
            capture_count=5,
        )
        save_baseline_profile(baseline, tmp_path)
        loaded = load_baseline_profile("drone-001", "1100", tmp_path)

        assert loaded.drone_id == "drone-001"
        assert loaded.throttle_preset == "1100"
        assert loaded.capture_count == 5
        np.testing.assert_array_almost_equal(loaded.freqs, spectral.freqs)
        np.testing.assert_array_almost_equal(loaded.psd_db, spectral.psd_db)

    def test_load_missing_profile_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_baseline_profile("no-drone", "9999", tmp_path)
