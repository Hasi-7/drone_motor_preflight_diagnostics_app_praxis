import argparse
import librosa
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from scipy.signal import welch, find_peaks

# ═══════════════════════════════════════════════════════════════
#  THRESHOLDS  (Randall, Ch.4 — 6 dB = significant change,
#               14-20 dB = serious fault requiring repair)
# ═══════════════════════════════════════════════════════════════
WARN_DB = 6    # Randall: "a change by a factor of 2 (6 dB) is significant"
CRIT_DB = 12   # Randall: machines flagged at 14-20 dB; 12 dB used as
               # early critical threshold to give warning before failure

# ═══════════════════════════════════════════════════════════════
#  MOTOR PARAMETERS  — update these for your specific motor
#  These are typical values for a small brushless drone motor.
#  N_POLES      : number of magnetic pole pairs (e.g. 7 for a 14-pole motor)
#  N_ROTOR_SLOTS: number of rotor slots  (check motor datasheet)
#  BEARING_*    : bearing geometry ratios (from datasheet or defaults below)
#    BPFO_RATIO = (N_balls/2) * (1 - ball_dia/pitch_dia * cos(contact_angle))
#    BPFI_RATIO = (N_balls/2) * (1 + ball_dia/pitch_dia * cos(contact_angle))
#  Defaults below are for a typical small deep-groove ball bearing.
# ═══════════════════════════════════════════════════════════════
N_POLES       = 7       # pole pairs  (14-pole motor → 7)
N_ROTOR_SLOTS = 12      # typical for small BLDC
BPFO_RATIO    = 3.0     # BPFO = BPFO_RATIO * shaft_freq  (typical ~3-4)
BPFI_RATIO    = 5.0     # BPFI = BPFI_RATIO * shaft_freq  (typical ~5-6)

# ═══════════════════════════════════════════════════════════════
#  SIGNAL LOADING & WELCH PSD
# ═══════════════════════════════════════════════════════════════

def load_segment(file_path, start, end):
    """Load audio file and return trimmed segment + sample rate."""
    samples, sr = librosa.load(file_path, sr=None)
    return samples[int(start * sr):int(end * sr)], sr


def compute_welch_psd(segment, sr, nperseg=4096):
    """
    Welch averaged PSD in dB.
    Randall Ch.4: averaged spectral estimation preferred over single FFT
    for stable fault detection via spectral comparison.
    """
    freqs, psd = welch(segment, fs=sr, window='hann',
                       nperseg=nperseg, noverlap=nperseg // 2,
                       scaling='density')
    psd_db = 10 * np.log10(psd + 1e-12)
    return freqs, psd_db


# ═══════════════════════════════════════════════════════════════
#  FUNDAMENTAL FREQUENCY DETECTION
#  Extract shaft rotation frequency directly from the spectrum.
#  Randall Ch.1: "families of harmonics with a given frequency
#  spacing almost certainly result from a forcing function at
#  that frequency" — we find the dominant low-freq peak.
# ═══════════════════════════════════════════════════════════════

def find_shaft_frequency(freqs, psd_db, f_min=50, f_max=500):
    """
    Find the fundamental shaft rotation frequency (1x) by locating
    the dominant spectral peak in the expected RPM range.
    For drone motors at ~50% throttle, shaft freq is typically 100-400 Hz.
    """
    mask = (freqs >= f_min) & (freqs <= f_max)
    search_psd = psd_db[mask]
    search_freqs = freqs[mask]
    peaks, _ = find_peaks(search_psd, height=np.max(search_psd) - 20,
                          distance=10)
    if len(peaks) == 0:
        # fallback: just take the max
        return search_freqs[np.argmax(search_psd)]
    return search_freqs[peaks[np.argmax(search_psd[peaks])]]


# ═══════════════════════════════════════════════════════════════
#  HELPER: peak dB value in a narrow band around a target freq
# ═══════════════════════════════════════════════════════════════

def peak_db_near(freqs, psd_db, target_freq, tolerance=0.05):
    """
    Return the max dB value within ±tolerance*target_freq of target_freq.
    Randall Ch.4: peak comparison used for discrete harmonic fault detection.
    """
    band = np.abs(freqs - target_freq) <= tolerance * target_freq
    if not np.any(band):
        return np.min(psd_db)
    return np.max(psd_db[band])


def band_avg_db(freqs, psd_db, f_low, f_high):
    """
    Return mean dB in a frequency band.
    Used for faults that raise broadband energy rather than a single peak.
    Randall Ch.4: "monitoring of frequency spectra rather than overall
    levels will have a better chance of detecting changes."
    """
    band = (freqs >= f_low) & (freqs <= f_high)
    if not np.any(band):
        return np.min(psd_db)
    return np.mean(psd_db[band])


# ═══════════════════════════════════════════════════════════════
#  STATUS HELPER
# ═══════════════════════════════════════════════════════════════

def status_from_deviation(deviation_db):
    """
    Map a dB deviation to a status string.
    Thresholds from Randall Ch.4:
      - 6 dB  = minimum significant change
      - 12 dB = serious fault (machines flagged for repair at 14-20 dB;
                12 dB chosen as early critical warning)
    """
    if deviation_db >= CRIT_DB:
        return "DO NOT FLY", "[RED]"
    elif deviation_db >= WARN_DB:
        return "WARNING", "[YELLOW]"
    else:
        return "READY TO FLY", "[GREEN]"


# ═══════════════════════════════════════════════════════════════
#  FAULT 1 — MASS IMBALANCE
#  Randall Ch.1/Ch.2: imbalance produces a dominant peak at 1x shaft
#  frequency. "even if the forcing function is relatively pure, such
#  as a simple unbalance" — deviation at 1x is the key indicator.
# ═══════════════════════════════════════════════════════════════

def check_imbalance(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Compare peak dB at 1x shaft frequency vs baseline.
    Source: Randall, Introduction and Background p.22 — unbalance
    produces sinusoidal forcing at 1x shaft speed.
    """
    test_peak = peak_db_near(freqs, psd_db, shaft_freq)
    bl_peak   = peak_db_near(bl_freqs, bl_psd_db, shaft_freq)
    deviation = test_peak - bl_peak
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"1x shaft ({shaft_freq:.1f} Hz)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 2 — MISALIGNMENT
#  Randall Ch.4 (Fault Detection p.151-152): misalignment confirmed
#  by elevated 2x and 4x harmonics. "second and fourth harmonics
#  were quite high...increases in vibration were due to increasing
#  misalignment."
# ═══════════════════════════════════════════════════════════════

def check_misalignment(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Check deviation at 2x and 4x shaft harmonics.
    Randall Fault Detection p.152: misalignment characteristically
    excites 2nd and 4th harmonics above the 1x peak.
    """
    deviations = []
    for harmonic in [2, 4]:
        f_target = harmonic * shaft_freq
        test_peak = peak_db_near(freqs, psd_db, f_target)
        bl_peak   = peak_db_near(bl_freqs, bl_psd_db, f_target)
        deviations.append(test_peak - bl_peak)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"2x/4x harmonics ({2*shaft_freq:.1f}/{4*shaft_freq:.1f} Hz)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 3 — BEARING INNER RACE (BPFI)
#  Randall Diagnostic Techniques p.195-196, p.211-212:
#  "a typical envelope spectrum for an inner race fault, with a
#  series of harmonics of BPFI, together with sidebands spaced
#  at shaft speed." BPFI appears at high frequency — check band
#  energy around expected BPFI and first 3 harmonics.
# ═══════════════════════════════════════════════════════════════

def check_bearing_inner(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Check band energy around BPFI and its first 3 harmonics.
    BPFI = BPFI_RATIO * shaft_freq  (geometry-dependent).
    Randall Diagnostic Techniques Section 5.5, p.195.
    """
    bpfi = BPFI_RATIO * shaft_freq
    deviations = []
    for n in [1, 2, 3]:
        f_target = n * bpfi
        bw = 0.1 * f_target  # 10% bandwidth around each harmonic
        test_band = band_avg_db(freqs, psd_db, f_target - bw, f_target + bw)
        bl_band   = band_avg_db(bl_freqs, bl_psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"BPFI band ({bpfi:.1f} Hz and harmonics)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 4 — BEARING OUTER RACE (BPFO)
#  Randall Diagnostic Techniques p.205: "For unidirectional load,
#  an outer race fault would not be modulated" — check clean BPFO
#  harmonics without sideband structure (simpler than BPFI).
# ═══════════════════════════════════════════════════════════════

def check_bearing_outer(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Check band energy around BPFO and its first 3 harmonics.
    BPFO = BPFO_RATIO * shaft_freq  (geometry-dependent).
    Randall Diagnostic Techniques Section 5.5, p.205.
    """
    bpfo = BPFO_RATIO * shaft_freq
    deviations = []
    for n in [1, 2, 3]:
        f_target = n * bpfo
        bw = 0.1 * f_target
        test_band = band_avg_db(freqs, psd_db, f_target - bw, f_target + bw)
        bl_band   = band_avg_db(bl_freqs, bl_psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"BPFO band ({bpfo:.1f} Hz and harmonics)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 5 — SHAFT CRACK (BREATHING CRACK)
#  Randall Introduction and Background p.22: "a crack in a shaft...
#  if the crack is 'breathing'...giving rise to responses at the
#  ODD harmonics of the shaft speed, in contrast to the even
#  harmonics primarily generated when the crack is permanently open."
#  Check 3x and 5x — these should be LOW in a healthy motor.
# ═══════════════════════════════════════════════════════════════

def check_shaft_crack(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Detect appearance/growth of odd shaft harmonics (3x, 5x).
    Randall Introduction p.22: breathing cracks generate odd harmonics.
    A healthy motor has very low energy at these frequencies.
    """
    deviations = []
    for harmonic in [3, 5]:
        f_target = harmonic * shaft_freq
        test_peak = peak_db_near(freqs, psd_db, f_target)
        bl_peak   = peak_db_near(bl_freqs, bl_psd_db, f_target)
        deviations.append(test_peak - bl_peak)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"Odd harmonics 3x/5x ({3*shaft_freq:.1f}/{5*shaft_freq:.1f} Hz)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 6 — GEAR TOOTH FAULT
#  Randall Fault Detection p.153 (Fig 4.9): "spectral changes are
#  primarily at widely distributed harmonics...sidebands around the
#  first two harmonics of the gearmesh frequency. Such a wide
#  distribution of sidebands is TYPICAL of a localized fault on a gear."
#  Toothmesh freq = N_ROTOR_SLOTS * shaft_freq.
# ═══════════════════════════════════════════════════════════════

def check_gear_fault(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Check sideband energy around gearmesh frequency (1x and 2x).
    Randall Fault Detection p.153: localized gear faults produce
    widely distributed sidebands spaced at shaft speed around
    toothmesh harmonics.
    """
    f_mesh = N_ROTOR_SLOTS * shaft_freq
    deviations = []
    for n in [1, 2]:
        f_target = n * f_mesh
        # check a ±3 shaft-freq wide band to capture sideband spread
        bw = 3 * shaft_freq
        test_band = band_avg_db(freqs, psd_db, f_target - bw, f_target + bw)
        bl_band   = band_avg_db(bl_freqs, bl_psd_db, f_target - bw, f_target + bw)
        deviations.append(test_band - bl_band)
    deviation = max(deviations)
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"Gearmesh band ({f_mesh:.1f} Hz +/-sidebands)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 7 — ELECTRICAL FAULT (ROTOR/STATOR ECCENTRICITY)
#  Randall Fault Detection p.148; Diagnostic Techniques p.161:
#  "slot-pass frequencies in electric motors...sideband spacing
#  is at slip frequency times the number of poles."
#  Slot-pass freq = N_ROTOR_SLOTS * shaft_freq (same as gearmesh
#  but here we look at sidebands spaced at N_POLES * shaft_freq).
# ═══════════════════════════════════════════════════════════════

def check_electrical_fault(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    """
    Check sideband energy around slot-pass frequency, spaced at
    pole-pass frequency (N_POLES * shaft_freq).
    Randall Fault Detection p.148: electrical faults in motors show
    as sidebands around slot-pass and electrical frequencies.
    """
    f_slot = N_ROTOR_SLOTS * shaft_freq
    f_pole_pass = N_POLES * shaft_freq  # sideband spacing
    deviations = []
    # check upper and lower sidebands around slot-pass freq
    for offset in [-f_pole_pass, f_pole_pass, -2*f_pole_pass, 2*f_pole_pass]:
        f_target = f_slot + offset
        if f_target > 0:
            test_peak = peak_db_near(freqs, psd_db, f_target)
            bl_peak   = peak_db_near(bl_freqs, bl_psd_db, f_target)
            deviations.append(test_peak - bl_peak)
    deviation = max(deviations) if deviations else 0
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, f"Slot-pass sidebands ({f_slot:.1f} Hz +/- pole-pass)"


# ═══════════════════════════════════════════════════════════════
#  FAULT 8 — GENERAL MECHANICAL DEGRADATION
#  Randall Fault Detection p.148: "monitoring of frequency spectra
#  rather than overall levels will have a better chance of detecting
#  changes at whatever frequency they should occur."
#  A raised broadband noise floor across the whole spectrum is a
#  non-specific but reliable early degradation indicator.
# ═══════════════════════════════════════════════════════════════

def check_general_degradation(freqs, psd_db, bl_freqs, bl_psd_db):
    """
    Compare mean noise floor across the full spectrum.
    Randall Fault Detection Section 4.2.2: broad spectral floor lift
    indicates general mechanical wear even before discrete peaks appear.
    Uses full spectrum average — not tied to any specific frequency.
    """
    # interpolate baseline onto test freq axis for fair comparison
    bl_interp = np.interp(freqs, bl_freqs, bl_psd_db)
    diff = psd_db - bl_interp
    # use the mean of the upper half of deviations (ignores local dips)
    positive_diffs = diff[diff > 0]
    deviation = np.mean(positive_diffs) if len(positive_diffs) > 0 else 0
    label, icon = status_from_deviation(deviation)
    return label, icon, deviation, "Broadband noise floor (full spectrum)"


# ═══════════════════════════════════════════════════════════════
#  PLOTTING
# ═══════════════════════════════════════════════════════════════

def plot_time(segment, sr, start, title):
    time = np.linspace(start, start + len(segment) / sr, len(segment))
    plt.figure(figsize=(12, 4))
    plt.plot(time, segment, linewidth=0.6)
    plt.xlabel("Time (s)")
    plt.ylabel("Amplitude")
    plt.title(f"{title} — Time Signal")
    plt.grid(True)
    plt.tight_layout()
    plt.show()


def plot_psd(freqs, psd_db, title, fmax=10000,
             bl_freqs=None, bl_psd_db=None, shaft_freq=None):
    fig, axes = plt.subplots(2 if bl_freqs is not None else 1,
                             1, figsize=(12, 8 if bl_freqs is not None else 4))

    if bl_freqs is None:
        ax = axes
        ax.plot(freqs, psd_db, linewidth=0.8, color='steelblue')
        ax.set_title(f"{title} — Welch PSD (dB)")
    else:
        axes[0].plot(bl_freqs, bl_psd_db, color='grey', linewidth=0.8,
                     label='Baseline', alpha=0.7)
        axes[0].plot(freqs, psd_db, color='steelblue', linewidth=0.8,
                     label=title)
        if shaft_freq:
            for n, c in zip([1,2,3,4], ['red','orange','green','purple']):
                axes[0].axvline(n * shaft_freq, color=c, linestyle='--',
                                linewidth=0.8, alpha=0.6, label=f'{n}x={n*shaft_freq:.0f}Hz')
        axes[0].set_title(f"{title} vs Baseline — Welch PSD (dB)")
        axes[0].legend(fontsize=7)
        axes[0].set_ylabel("Power (dB)")
        axes[0].grid(True)

        diff = psd_db - np.interp(freqs, bl_freqs, bl_psd_db)
        axes[1].plot(freqs, diff, color='firebrick', linewidth=0.8)
        axes[1].axhline(WARN_DB, color='orange', linestyle='--',
                        linewidth=1, label=f'+{WARN_DB} dB warning')
        axes[1].axhline(CRIT_DB, color='red', linestyle='--',
                        linewidth=1, label=f'+{CRIT_DB} dB critical')
        axes[1].axhline(0, color='grey', linestyle='-', linewidth=0.5)
        axes[1].set_title("Spectral Difference (test − baseline) dB")
        axes[1].set_ylabel("ΔdB")
        axes[1].legend(fontsize=8)
        axes[1].grid(True)

    for a in (axes if isinstance(axes, np.ndarray) else [axes]):
        a.set_xlim(0, fmax)
        a.set_xlabel("Frequency (Hz)")
    plt.tight_layout()
    plt.show()


def print_report(motor_name, results, shaft_freq):
    """Print a formatted fault report for one motor."""
    print(f"\n{'='*60}")
    print(f"  FAULT REPORT — {motor_name}")
    print(f"  Detected shaft frequency: {shaft_freq:.1f} Hz  "
          f"(~{shaft_freq*60:.0f} RPM)")
    print(f"{'='*60}")
    print(f"  {'Fault':<30} {'Status':<16} {'Deviation':>10}  {'Band'}")
    print(f"  {'-'*56}")
    overall = "READY TO FLY [GREEN]"
    for fault_name, (label, icon, dev, band) in results.items():
        print(f"  {fault_name:<30} {icon+' '+label:<16} {dev:>+8.1f} dB  {band}")
        if label == "DO NOT FLY":
            overall = "DO NOT FLY [RED]"
        elif label == "WARNING" and overall != "DO NOT FLY [RED]":
            overall = "WARNING [YELLOW]"
    print(f"{'-'*60}")
    print(f"  OVERALL STATUS: {overall}")
    print(f"{'='*60}\n")


# ═══════════════════════════════════════════════════════════════
#  BASELINE MANAGEMENT
# ═══════════════════════════════════════════════════════════════

def save_baseline(freqs, psd_db, out_path):
    np.savez(out_path, freqs=freqs, psd_db=psd_db)
    print(f"Baseline saved → {out_path}")


def load_baseline(npz_path):
    data = np.load(npz_path)
    return data['freqs'], data['psd_db']


# ═══════════════════════════════════════════════════════════════
#  RUN ALL 8 CHECKS FOR ONE MOTOR
# ═══════════════════════════════════════════════════════════════

def run_all_checks(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq):
    return {
        "1. Imbalance":          check_imbalance(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "2. Misalignment":       check_misalignment(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "3. Bearing Inner Race": check_bearing_inner(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "4. Bearing Outer Race": check_bearing_outer(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "5. Shaft Crack":        check_shaft_crack(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "6. Gear Tooth Fault":   check_gear_fault(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "7. Electrical Fault":   check_electrical_fault(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq),
        "8. General Degradation":check_general_degradation(freqs, psd_db, bl_freqs, bl_psd_db),
    }


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--motor-audio", required=True, help="Path to the motor audio file")
    parser.add_argument(
        "--baseline-audio",
        default=str(Path(__file__).with_name("Healthy_baseline.mp3")),
        help="Path to the baseline audio file",
    )
    args = parser.parse_args()

    MOTORS = {
        Path(args.motor_audio).stem.replace("_", " "): args.motor_audio,
    }
    BASELINE_PATH = args.baseline_audio

    # ── Build baseline (Motor 1 used as placeholder) ─────────────
    print("Loading baseline (Motor 1 placeholder)...")
    bl_seg, bl_sr = load_segment(BASELINE_PATH, start=2, end=8)
    bl_freqs, bl_psd_db = compute_welch_psd(bl_seg, bl_sr)

    # ── Process each motor ────────────────────────────────────────
    for name, path in MOTORS.items():
        print(f"\nProcessing {name}...")
        segment, sr = load_segment(path, start=2, end=8)
        freqs, psd_db = compute_welch_psd(segment, sr)

        # Detect shaft frequency from the spectrum itself
        shaft_freq = find_shaft_frequency(freqs, psd_db)

        # Time domain plot
        plot_time(segment, sr, start=2, title=name)

        # PSD comparison plot with difference panel
        plot_psd(freqs, psd_db, name, fmax=10000,
                 bl_freqs=bl_freqs, bl_psd_db=bl_psd_db,
                 shaft_freq=shaft_freq)

        # Run all 8 fault checks
        results = run_all_checks(freqs, psd_db, bl_freqs, bl_psd_db, shaft_freq)

        # Print report
        print_report(name, results, shaft_freq)
