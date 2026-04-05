"""
Spectral analysis stage: Welch PSD, shaft frequency detection, band helpers.

Behavioral parity with sound_final_design_2.py:
  - compute_welch_psd
  - find_shaft_frequency
  - peak_db_near
  - band_avg_db
"""
import numpy as np
from scipy.signal import welch, find_peaks

from .config import WELCH_NPERSEG, SHAFT_FREQ_MIN_HZ, SHAFT_FREQ_MAX_HZ
from .models import PreprocessedData, SpectralData


def compute_welch_psd(
    data: PreprocessedData,
    nperseg: int = WELCH_NPERSEG,
) -> SpectralData:
    """Compute Welch averaged PSD in dB.

    Randall Ch.4: averaged spectral estimation preferred over single FFT
    for stable fault detection via spectral comparison.

    Equivalent to compute_welch_psd() in the legacy code.
    """
    freqs, psd = welch(
        data.segment,
        fs=data.sample_rate,
        window="hann",
        nperseg=nperseg,
        noverlap=nperseg // 2,
        scaling="density",
    )
    psd_db = 10.0 * np.log10(psd + 1e-12)
    return SpectralData(freqs=freqs, psd_db=psd_db)


def find_shaft_frequency(
    spectral: SpectralData,
    f_min: float = SHAFT_FREQ_MIN_HZ,
    f_max: float = SHAFT_FREQ_MAX_HZ,
) -> float:
    """Find the fundamental shaft rotation frequency (1x) from the spectrum.

    Locates the dominant spectral peak in the expected RPM range.
    For drone motors at ~50% throttle, shaft freq is typically 100–400 Hz.

    Equivalent to find_shaft_frequency() in the legacy code.

    Returns:
        Estimated shaft frequency in Hz.
    """
    freqs = spectral.freqs
    psd_db = spectral.psd_db

    mask = (freqs >= f_min) & (freqs <= f_max)
    search_psd = psd_db[mask]
    search_freqs = freqs[mask]

    peaks, _ = find_peaks(
        search_psd,
        height=np.max(search_psd) - 20,
        distance=10,
    )
    if len(peaks) == 0:
        # fallback: take the global max in the search band
        return float(search_freqs[np.argmax(search_psd)])

    return float(search_freqs[peaks[np.argmax(search_psd[peaks])]])


def peak_db_near(
    spectral: SpectralData,
    target_freq: float,
    tolerance: float = 0.05,
) -> float:
    """Return the max dB value within ±tolerance*target_freq of target_freq.

    Randall Ch.4: peak comparison used for discrete harmonic fault detection.

    Equivalent to peak_db_near() in the legacy code.
    """
    band = np.abs(spectral.freqs - target_freq) <= tolerance * target_freq
    if not np.any(band):
        return float(np.min(spectral.psd_db))
    return float(np.max(spectral.psd_db[band]))


def band_avg_db(
    spectral: SpectralData,
    f_low: float,
    f_high: float,
) -> float:
    """Return mean dB in a frequency band.

    Used for faults that raise broadband energy rather than a single peak.
    Randall Ch.4: monitoring of frequency spectra has better chance of
    detecting changes than overall levels.

    Equivalent to band_avg_db() in the legacy code.
    """
    band = (spectral.freqs >= f_low) & (spectral.freqs <= f_high)
    if not np.any(band):
        return float(np.min(spectral.psd_db))
    return float(np.mean(spectral.psd_db[band]))


# ── Raw-array variants (used by postprocessing for baseline comparisons) ───

def peak_db_near_raw(
    freqs: np.ndarray,
    psd_db: np.ndarray,
    target_freq: float,
    tolerance: float = 0.05,
) -> float:
    """peak_db_near operating on raw numpy arrays (for legacy compatibility)."""
    return peak_db_near(SpectralData(freqs=freqs, psd_db=psd_db), target_freq, tolerance)


def band_avg_db_raw(
    freqs: np.ndarray,
    psd_db: np.ndarray,
    f_low: float,
    f_high: float,
) -> float:
    """band_avg_db operating on raw numpy arrays (for legacy compatibility)."""
    return band_avg_db(SpectralData(freqs=freqs, psd_db=psd_db), f_low, f_high)
