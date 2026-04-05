"""
Analysis configuration constants.

Thresholds are from Randall, "Vibration-Based Condition Monitoring":
  - 6 dB  = significant change (factor of 2 in amplitude)
  - 12 dB = early critical threshold (machines flagged for repair at 14-20 dB;
            12 dB chosen here to give warning before failure)

Motor geometry defaults are for a typical small brushless drone motor.
Override via MotorConfig when building a DiagnosticPipeline.
"""
from dataclasses import dataclass

# ── dB deviation thresholds ────────────────────────────────────────────────
WARN_DB: float = 6.0
CRIT_DB: float = 12.0

# ── Welch PSD defaults ─────────────────────────────────────────────────────
WELCH_NPERSEG: int = 4096

# ── Shaft frequency search range (Hz) ─────────────────────────────────────
SHAFT_FREQ_MIN_HZ: float = 50.0
SHAFT_FREQ_MAX_HZ: float = 500.0

# ── Default motor geometry ─────────────────────────────────────────────────
DEFAULT_N_POLES: int = 7          # pole pairs (14-pole motor → 7)
DEFAULT_N_ROTOR_SLOTS: int = 12   # typical for small BLDC
DEFAULT_BPFO_RATIO: float = 3.0   # BPFO = ratio * shaft_freq
DEFAULT_BPFI_RATIO: float = 5.0   # BPFI = ratio * shaft_freq


@dataclass
class MotorConfig:
    """Geometry constants for a specific motor model.

    Defaults match the original sound_final_design_2.py values and represent
    a typical small brushless drone motor with a 14-pole rotor.
    """
    n_poles: int = DEFAULT_N_POLES
    n_rotor_slots: int = DEFAULT_N_ROTOR_SLOTS
    bpfo_ratio: float = DEFAULT_BPFO_RATIO
    bpfi_ratio: float = DEFAULT_BPFI_RATIO
