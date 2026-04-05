"""
Preprocessing stage: load and trim audio for analysis.

Behavioral parity with sound_final_design_2.py::load_segment.
"""
from pathlib import Path

import librosa
import numpy as np

from .models import PreprocessedData


def load_segment(
    file_path: str | Path,
    start: float,
    end: float,
) -> PreprocessedData:
    """Load an audio file and return the trimmed analysis segment.

    Directly equivalent to load_segment() in the legacy code.

    Args:
        file_path: Path to the audio file (WAV or MP3).
        start: Start time in seconds.
        end: End time in seconds.

    Returns:
        PreprocessedData with the trimmed float32 samples and sample rate.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    samples, sr = librosa.load(str(file_path), sr=None)
    start_idx = int(start * sr)
    end_idx = int(end * sr)
    segment = samples[start_idx:end_idx]

    if len(segment) == 0:
        raise ValueError(
            f"Trimmed segment is empty for file '{file_path}' "
            f"(start={start}s, end={end}s, total_duration={len(samples)/sr:.2f}s)"
        )

    return PreprocessedData(
        segment=segment,
        sample_rate=sr,
        start_s=start,
        end_s=end,
    )
