"""Tests for analysis.preprocessing — audio loading and trimming."""
import tempfile
from pathlib import Path

import numpy as np
import pytest
import scipy.io.wavfile as wav

from analysis.models import PreprocessedData
from analysis.preprocessing import load_segment


def _write_test_wav(path: Path, sr: int = 22050, duration: float = 5.0) -> None:
    """Write a short sine wave WAV for testing."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    signal = (np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    wav.write(str(path), sr, signal)


class TestLoadSegment:
    def test_returns_preprocessed_data(self, tmp_path):
        wav_path = tmp_path / "test.wav"
        _write_test_wav(wav_path)
        result = load_segment(wav_path, start=1.0, end=3.0)
        assert isinstance(result, PreprocessedData)

    def test_segment_length(self, tmp_path):
        sr = 22050
        wav_path = tmp_path / "test.wav"
        _write_test_wav(wav_path, sr=sr, duration=5.0)
        result = load_segment(wav_path, start=1.0, end=3.0)
        expected_len = int(2.0 * result.sample_rate)
        # Allow ±2 samples for rounding differences
        assert abs(len(result.segment) - expected_len) <= 2

    def test_start_end_stored(self, tmp_path):
        wav_path = tmp_path / "test.wav"
        _write_test_wav(wav_path)
        result = load_segment(wav_path, start=2.0, end=4.0)
        assert result.start_s == pytest.approx(2.0)
        assert result.end_s == pytest.approx(4.0)

    def test_file_not_found_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_segment(tmp_path / "nonexistent.wav", 0, 1)

    def test_empty_segment_raises(self, tmp_path):
        wav_path = tmp_path / "test.wav"
        _write_test_wav(wav_path, duration=2.0)
        with pytest.raises(ValueError, match="empty"):
            load_segment(wav_path, start=10.0, end=11.0)
