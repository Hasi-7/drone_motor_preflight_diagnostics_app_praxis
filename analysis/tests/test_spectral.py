"""Tests for analysis.spectral — Welch PSD, shaft freq, peak/band helpers."""
import numpy as np
import pytest

from analysis.models import PreprocessedData, SpectralData
from analysis.spectral import (
    band_avg_db,
    compute_welch_psd,
    find_shaft_frequency,
    peak_db_near,
)


def _make_sine_data(freq_hz: float = 200.0, sr: int = 44100, duration: float = 2.0) -> PreprocessedData:
    """Synthesise a pure sine wave for spectral tests."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    signal = np.sin(2 * np.pi * freq_hz * t).astype(np.float32)
    return PreprocessedData(segment=signal, sample_rate=sr, start_s=0.0, end_s=duration)


class TestComputeWelchPSD:
    def test_returns_spectral_data(self):
        data = _make_sine_data()
        result = compute_welch_psd(data)
        assert isinstance(result, SpectralData)
        assert len(result.freqs) == len(result.psd_db)
        assert len(result.freqs) > 0

    def test_freqs_start_at_zero(self):
        data = _make_sine_data()
        result = compute_welch_psd(data)
        assert result.freqs[0] == pytest.approx(0.0)

    def test_psd_in_db(self):
        """PSD values should be in dB (typically negative or near-zero for a sine)."""
        data = _make_sine_data()
        result = compute_welch_psd(data)
        # dB values for unit-amplitude signal — should be finite
        assert np.all(np.isfinite(result.psd_db))

    def test_sine_peak_at_correct_frequency(self):
        """Dominant peak should be near the input sine frequency."""
        freq = 300.0
        data = _make_sine_data(freq_hz=freq)
        spectral = compute_welch_psd(data)
        peak_idx = np.argmax(spectral.psd_db)
        detected_freq = spectral.freqs[peak_idx]
        assert abs(detected_freq - freq) < 10.0  # within 10 Hz


class TestFindShaftFrequency:
    def test_detects_sine_frequency(self):
        freq = 250.0
        data = _make_sine_data(freq_hz=freq)
        spectral = compute_welch_psd(data)
        shaft = find_shaft_frequency(spectral)
        assert abs(shaft - freq) < 15.0

    def test_fallback_when_no_peaks(self):
        """Should return a value even for white-noise-like signals."""
        rng = np.random.default_rng(42)
        signal = rng.standard_normal(44100).astype(np.float32)
        data = PreprocessedData(segment=signal, sample_rate=44100, start_s=0.0, end_s=1.0)
        spectral = compute_welch_psd(data)
        shaft = find_shaft_frequency(spectral)
        assert 50.0 <= shaft <= 500.0


class TestPeakDbNear:
    def test_peak_at_target(self):
        freq = 100.0
        data = _make_sine_data(freq_hz=freq)
        spectral = compute_welch_psd(data)
        peak = peak_db_near(spectral, freq)
        # The sine peak should be well above baseline noise
        noise_level = np.percentile(spectral.psd_db, 10)
        assert peak > noise_level

    def test_returns_min_when_band_empty(self):
        spectral = SpectralData(
            freqs=np.array([100.0, 200.0, 300.0]),
            psd_db=np.array([-40.0, -30.0, -50.0]),
        )
        # tolerance=0 means band is empty
        result = peak_db_near(spectral, 1_000_000.0, tolerance=0.0)
        assert result == pytest.approx(-50.0)


class TestBandAvgDb:
    def test_returns_mean_in_band(self):
        spectral = SpectralData(
            freqs=np.array([100.0, 200.0, 300.0, 400.0]),
            psd_db=np.array([-10.0, -20.0, -30.0, -40.0]),
        )
        result = band_avg_db(spectral, 150.0, 350.0)
        # 200 and 300 Hz are in band → mean of -20 and -30 = -25
        assert result == pytest.approx(-25.0)

    def test_returns_min_when_no_bins_in_band(self):
        spectral = SpectralData(
            freqs=np.array([100.0, 200.0]),
            psd_db=np.array([-10.0, -20.0]),
        )
        result = band_avg_db(spectral, 500.0, 600.0)
        assert result == pytest.approx(-20.0)
