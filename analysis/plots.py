"""
Plot generation: waveform and PSD comparison plots.

Behavioral parity with sound_final_design_2.py::plot_time and plot_psd,
with the key change that plots are saved to disk (headless) rather than
displayed interactively via plt.show(). This enables the sidecar to run
without a display.

matplotlib is imported lazily inside each function so that non-plotting
code paths (record, baseline-gen, baseline-avg) do not require it.
"""
from pathlib import Path
from typing import Optional

import numpy as np

from .config import WARN_DB, CRIT_DB
from .models import PreprocessedData, SpectralData


def plot_waveform(
    data: PreprocessedData,
    out_path: str | Path,
    title: str = "Motor",
) -> Path:
    """Save a time-domain waveform plot.

    Equivalent to plot_time() in the legacy code.

    Args:
        data: Preprocessed audio data.
        out_path: Destination PNG file path.
        title: Plot title label.

    Returns:
        Path to the saved PNG.
    """
    import matplotlib
    matplotlib.use("Agg")  # headless — no-op if pyplot already loaded with Agg
    import matplotlib.pyplot as plt

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    time = np.linspace(
        data.start_s,
        data.start_s + len(data.segment) / data.sample_rate,
        len(data.segment),
    )

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(time, data.segment, linewidth=0.6)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Amplitude")
    ax.set_title(f"{title} — Time Signal")
    ax.grid(True)
    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)

    return out_path


def plot_psd_comparison(
    test: SpectralData,
    out_path: str | Path,
    title: str = "Motor",
    fmax: float = 10000.0,
    baseline: Optional[SpectralData] = None,
    shaft_freq: Optional[float] = None,
) -> Path:
    """Save a Welch PSD plot, optionally with a baseline comparison panel.

    Equivalent to plot_psd() in the legacy code.

    When a baseline is provided, produces a two-panel figure:
      - Top: test PSD vs baseline overlay with harmonic markers
      - Bottom: spectral difference (test − baseline) with threshold lines

    Args:
        test: Test spectral data.
        out_path: Destination PNG file path.
        title: Plot title label.
        fmax: Maximum frequency to display (Hz).
        baseline: Optional baseline spectral data for comparison.
        shaft_freq: Optional shaft frequency for harmonic marker lines.

    Returns:
        Path to the saved PNG.
    """
    import matplotlib
    matplotlib.use("Agg")  # headless — no-op if pyplot already loaded with Agg
    import matplotlib.pyplot as plt

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    n_panels = 2 if baseline is not None else 1
    fig, axes = plt.subplots(n_panels, 1, figsize=(12, 8 if n_panels == 2 else 4))

    if baseline is None:
        ax = axes
        ax.plot(test.freqs, test.psd_db, linewidth=0.8, color="steelblue")
        ax.set_title(f"{title} — Welch PSD (dB)")
        ax.set_xlim(0, fmax)
        ax.set_xlabel("Frequency (Hz)")
        ax.set_ylabel("Power (dB)")
        ax.grid(True)
    else:
        ax_top, ax_bot = axes[0], axes[1]

        # Top panel: overlay
        ax_top.plot(
            baseline.freqs, baseline.psd_db,
            color="grey", linewidth=0.8, label="Baseline", alpha=0.7,
        )
        ax_top.plot(
            test.freqs, test.psd_db,
            color="steelblue", linewidth=0.8, label=title,
        )
        if shaft_freq is not None:
            colors = ["red", "orange", "green", "purple"]
            for n, c in zip([1, 2, 3, 4], colors):
                ax_top.axvline(
                    n * shaft_freq, color=c, linestyle="--",
                    linewidth=0.8, alpha=0.6,
                    label=f"{n}x={n*shaft_freq:.0f}Hz",
                )
        ax_top.set_title(f"{title} vs Baseline — Welch PSD (dB)")
        ax_top.legend(fontsize=7)
        ax_top.set_ylabel("Power (dB)")
        ax_top.set_xlim(0, fmax)
        ax_top.grid(True)

        # Bottom panel: difference
        diff = test.psd_db - np.interp(test.freqs, baseline.freqs, baseline.psd_db)
        ax_bot.plot(test.freqs, diff, color="firebrick", linewidth=0.8)
        ax_bot.axhline(
            WARN_DB, color="orange", linestyle="--",
            linewidth=1, label=f"+{WARN_DB} dB warning",
        )
        ax_bot.axhline(
            CRIT_DB, color="red", linestyle="--",
            linewidth=1, label=f"+{CRIT_DB} dB critical",
        )
        ax_bot.axhline(0, color="grey", linestyle="-", linewidth=0.5)
        ax_bot.set_title("Spectral Difference (test − baseline) dB")
        ax_bot.set_ylabel("ΔdB")
        ax_bot.set_xlim(0, fmax)
        ax_bot.set_xlabel("Frequency (Hz)")
        ax_bot.legend(fontsize=8)
        ax_bot.grid(True)

    fig.tight_layout()
    fig.savefig(out_path, dpi=100)
    plt.close(fig)

    return out_path
