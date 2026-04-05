"""Integration tests for analysis.pipeline — full pipeline execution."""
import json
import tempfile
from pathlib import Path

import numpy as np
import pytest
import scipy.io.wavfile as wav

from analysis.baseline import save_baseline
from analysis.models import SpectralData
from analysis.pipeline import DiagnosticPipeline, PipelineInput


def _write_sine_wav(path: Path, freq: float = 200.0, sr: int = 22050, duration: float = 10.0) -> None:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    signal = (np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)
    wav.write(str(path), sr, signal)


def _make_flat_baseline(n: int = 2049, sr: float = 22050.0) -> SpectralData:
    freqs = np.linspace(0, sr / 2, n)
    psd_db = np.full(n, -60.0)
    return SpectralData(freqs=freqs, psd_db=psd_db)


class TestDiagnosticPipeline:
    def setup_method(self, tmp_path_factory=None):
        # We rely on pytest's tmp_path fixture per-test instead
        pass

    def test_full_run_completes(self, tmp_path):
        wav_path = tmp_path / "motor.wav"
        _write_sine_wav(wav_path, freq=200.0)

        baseline_path = tmp_path / "baseline.npz"
        save_baseline(_make_flat_baseline(), baseline_path)

        output_dir = tmp_path / "run_output"
        inp = PipelineInput(
            wav_path=wav_path,
            baseline_npz_path=baseline_path,
            output_dir=output_dir,
            start_s=1.0,
            end_s=4.0,
            motor_name="Motor 1",
            test_id="test-123",
        )
        pipeline = DiagnosticPipeline()
        state = pipeline.run(inp)

        assert state.test_id == "test-123"
        assert state.diagnostic is not None
        assert state.diagnostic.overall_status in {"READY TO FLY", "WARNING", "DO NOT FLY"}
        assert len(state.diagnostic.fault_checks) == 8

    def test_artifacts_created(self, tmp_path):
        wav_path = tmp_path / "motor.wav"
        _write_sine_wav(wav_path)

        baseline_path = tmp_path / "baseline.npz"
        save_baseline(_make_flat_baseline(), baseline_path)

        output_dir = tmp_path / "out"
        inp = PipelineInput(
            wav_path=wav_path,
            baseline_npz_path=baseline_path,
            output_dir=output_dir,
            start_s=1.0,
            end_s=4.0,
        )
        state = DiagnosticPipeline().run(inp)

        assert state.artifacts is not None
        assert state.artifacts.waveform_png_path.exists()
        assert state.artifacts.psd_png_path.exists()
        assert state.artifacts.preprocessed_npz_path.exists()
        assert state.artifacts.fft_npz_path.exists()
        assert state.artifacts.result_json_path.exists()

    def test_result_json_structure(self, tmp_path):
        wav_path = tmp_path / "motor.wav"
        _write_sine_wav(wav_path)

        baseline_path = tmp_path / "baseline.npz"
        save_baseline(_make_flat_baseline(), baseline_path)

        inp = PipelineInput(
            wav_path=wav_path,
            baseline_npz_path=baseline_path,
            output_dir=tmp_path / "out",
            start_s=1.0,
            end_s=4.0,
            drone_id="drone-001",
            throttle_preset="1100",
            motor_name="Motor 2",
        )
        state = DiagnosticPipeline().run(inp)

        result_json = json.loads(state.artifacts.result_json_path.read_text())
        assert result_json["schema_version"] == "1"
        assert result_json["drone_id"] == "drone-001"
        assert result_json["throttle_preset"] == "1100"
        assert "diagnostic" in result_json
        assert result_json["diagnostic"]["motor_name"] == "Motor 2"
        assert len(result_json["diagnostic"]["fault_checks"]) == 8

    def test_missing_baseline_raises(self, tmp_path):
        wav_path = tmp_path / "motor.wav"
        _write_sine_wav(wav_path)

        inp = PipelineInput(
            wav_path=wav_path,
            # no baseline provided
            output_dir=tmp_path / "out",
            start_s=1.0,
            end_s=4.0,
        )
        with pytest.raises(ValueError, match="baseline"):
            DiagnosticPipeline().run(inp)

    def test_missing_wav_raises(self, tmp_path):
        baseline_path = tmp_path / "baseline.npz"
        save_baseline(_make_flat_baseline(), baseline_path)

        inp = PipelineInput(
            wav_path=tmp_path / "nonexistent.wav",
            baseline_npz_path=baseline_path,
            output_dir=tmp_path / "out",
        )
        with pytest.raises(FileNotFoundError):
            DiagnosticPipeline().run(inp)
