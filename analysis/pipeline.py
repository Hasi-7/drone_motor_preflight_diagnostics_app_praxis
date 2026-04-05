"""
Pipeline orchestration: stage-by-stage execution for one motor run.

The pipeline has no UI side effects and does not call plt.show().
Each stage can be executed independently for testing or debugging.

Stages:
  1. ingest      — validate inputs
  2. preprocess  — load and trim audio
  3. spectral    — compute Welch PSD
  4. baseline    — load baseline profile
  5. classify    — run all 8 fault checks
  6. artifacts   — save plots and npz files
  7. report      — write JSON result
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from .baseline import load_baseline_profile, load_baseline
from .config import MotorConfig
from .models import (
    DiagnosticResult,
    PreprocessedData,
    RunArtifacts,
    SpectralData,
)
from .plots import plot_waveform, plot_psd_comparison
from .postprocessing import run_all_checks
from .preprocessing import load_segment
from .reporting import save_result_json
from .spectral import compute_welch_psd, find_shaft_frequency


@dataclass
class PipelineInput:
    """Inputs required to execute a full diagnostic pipeline run."""
    wav_path: str | Path
    baseline_npz_path: Optional[str | Path] = None
    # Alternative: named profile resolution
    drone_id: Optional[str] = None
    throttle_preset: Optional[str] = None
    baselines_dir: Optional[str | Path] = None
    # Trim window
    start_s: float = 2.0
    end_s: float = 8.0
    # Motor identity
    motor_name: str = "Motor"
    motor_config: MotorConfig = field(default_factory=MotorConfig)
    # Output
    output_dir: Optional[str | Path] = None
    test_id: Optional[str] = None
    # Metadata for reporting
    microphone_name: Optional[str] = None
    app_version: Optional[str] = None
    analysis_version: Optional[str] = None


@dataclass
class PipelineStageResult:
    """Intermediate results accumulated across pipeline stages."""
    test_id: str
    preprocessed: Optional[PreprocessedData] = None
    test_spectral: Optional[SpectralData] = None
    baseline_spectral: Optional[SpectralData] = None
    shaft_freq_hz: Optional[float] = None
    diagnostic: Optional[DiagnosticResult] = None
    artifacts: Optional[RunArtifacts] = None
    completed_at: Optional[str] = None


class DiagnosticPipeline:
    """Orchestrates all analysis stages for one motor diagnostic run.

    Usage::

        pipeline = DiagnosticPipeline()
        result = pipeline.run(PipelineInput(
            wav_path="run.wav",
            baseline_npz_path="baseline.npz",
            output_dir="app-data/runs/test-001",
        ))
    """

    def run(self, inp: PipelineInput) -> PipelineStageResult:
        """Execute all pipeline stages sequentially and return results."""
        test_id = inp.test_id or str(uuid.uuid4())
        output_dir = Path(inp.output_dir) if inp.output_dir else Path("app-data/runs") / test_id
        output_dir.mkdir(parents=True, exist_ok=True)

        state = PipelineStageResult(test_id=test_id)

        state = self._stage_preprocess(inp, state)
        state = self._stage_spectral(inp, state)
        state = self._stage_baseline(inp, state)
        state = self._stage_classify(inp, state, output_dir)
        state = self._stage_artifacts(inp, state, output_dir)
        state = self._stage_report(inp, state, output_dir)

        state.completed_at = datetime.now(timezone.utc).isoformat()
        return state

    # ── Stage 1: preprocess ───────────────────────────────────────────────

    def _stage_preprocess(
        self, inp: PipelineInput, state: PipelineStageResult
    ) -> PipelineStageResult:
        state.preprocessed = load_segment(inp.wav_path, inp.start_s, inp.end_s)
        return state

    # ── Stage 2: spectral ─────────────────────────────────────────────────

    def _stage_spectral(
        self, inp: PipelineInput, state: PipelineStageResult
    ) -> PipelineStageResult:
        assert state.preprocessed is not None
        state.test_spectral = compute_welch_psd(state.preprocessed)
        state.shaft_freq_hz = find_shaft_frequency(state.test_spectral)
        return state

    # ── Stage 3: load baseline ────────────────────────────────────────────

    def _stage_baseline(
        self, inp: PipelineInput, state: PipelineStageResult
    ) -> PipelineStageResult:
        if inp.baseline_npz_path is not None:
            state.baseline_spectral = load_baseline(inp.baseline_npz_path)
        elif inp.drone_id and inp.throttle_preset and inp.baselines_dir:
            baseline_data = load_baseline_profile(
                inp.drone_id, inp.throttle_preset, inp.baselines_dir
            )
            state.baseline_spectral = baseline_data.to_spectral()
        else:
            raise ValueError(
                "Pipeline requires either baseline_npz_path or "
                "(drone_id + throttle_preset + baselines_dir)"
            )
        return state

    # ── Stage 4: classify ─────────────────────────────────────────────────

    def _stage_classify(
        self, inp: PipelineInput, state: PipelineStageResult, output_dir: Path
    ) -> PipelineStageResult:
        assert state.test_spectral is not None
        assert state.baseline_spectral is not None
        assert state.shaft_freq_hz is not None

        state.diagnostic = run_all_checks(
            test=state.test_spectral,
            baseline=state.baseline_spectral,
            shaft_freq=state.shaft_freq_hz,
            motor_config=inp.motor_config,
            motor_name=inp.motor_name,
        )
        return state

    # ── Stage 5: save artifacts ───────────────────────────────────────────

    def _stage_artifacts(
        self, inp: PipelineInput, state: PipelineStageResult, output_dir: Path
    ) -> PipelineStageResult:
        assert state.preprocessed is not None
        assert state.test_spectral is not None
        assert state.baseline_spectral is not None
        assert state.shaft_freq_hz is not None

        artifacts = RunArtifacts(test_id=state.test_id, output_dir=output_dir)

        # Waveform PNG
        waveform_path = output_dir / "waveform.png"
        plot_waveform(state.preprocessed, waveform_path, title=inp.motor_name)
        artifacts.waveform_png_path = waveform_path

        # PSD comparison PNG
        psd_path = output_dir / "psd.png"
        plot_psd_comparison(
            test=state.test_spectral,
            out_path=psd_path,
            title=inp.motor_name,
            baseline=state.baseline_spectral,
            shaft_freq=state.shaft_freq_hz,
        )
        artifacts.psd_png_path = psd_path

        # Preprocessed signal .npz
        pre_path = output_dir / "preprocessed_signal.npz"
        np.savez(
            str(pre_path),
            segment=state.preprocessed.segment,
            sample_rate=np.array(state.preprocessed.sample_rate),
            start_s=np.array(state.preprocessed.start_s),
            end_s=np.array(state.preprocessed.end_s),
        )
        artifacts.preprocessed_npz_path = pre_path

        # FFT/PSD data .npz
        fft_path = output_dir / "fft_data.npz"
        np.savez(
            str(fft_path),
            freqs=state.test_spectral.freqs,
            psd_db=state.test_spectral.psd_db,
            baseline_freqs=state.baseline_spectral.freqs,
            baseline_psd_db=state.baseline_spectral.psd_db,
            shaft_freq_hz=np.array(state.shaft_freq_hz),
        )
        artifacts.fft_npz_path = fft_path

        state.artifacts = artifacts
        return state

    # ── Stage 6: persist result JSON ──────────────────────────────────────

    def _stage_report(
        self, inp: PipelineInput, state: PipelineStageResult, output_dir: Path
    ) -> PipelineStageResult:
        assert state.diagnostic is not None
        assert state.artifacts is not None

        result_path = output_dir / "result.json"
        save_result_json(
            result=state.diagnostic,
            artifacts=state.artifacts,
            test_id=state.test_id,
            out_path=result_path,
            drone_id=inp.drone_id,
            throttle_preset=inp.throttle_preset,
            microphone_name=inp.microphone_name,
            app_version=inp.app_version,
            analysis_version=inp.analysis_version,
        )
        state.artifacts.result_json_path = result_path
        return state
