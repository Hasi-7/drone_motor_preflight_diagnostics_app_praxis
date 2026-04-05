"""
Analysis sidecar CLI entry point.

Electron launches this script to perform analysis operations. All output is
written to disk and the final JSON result is printed to stdout so Electron
can capture it via the child process pipe.

Commands
--------
  analyze         Run a full diagnostic pipeline on one WAV file.
  baseline-gen    Generate and save a baseline from one WAV capture.
  baseline-avg    Average multiple .npz baselines into one profile.

Examples
--------
  python -m analysis.api analyze \\
      --wav run.wav \\
      --baseline-npz baselines/drone1/1100/baseline.npz \\
      --output-dir app-data/runs/test-001 \\
      --motor-name "Motor 1" \\
      --start 2.0 --end 8.0

  python -m analysis.api baseline-gen \\
      --wav capture.wav \\
      --out baselines/drone1/1100/run1.npz \\
      --start 2.0 --end 8.0

  python -m analysis.api baseline-avg \\
      --npz run1.npz run2.npz run3.npz run4.npz run5.npz \\
      --drone-id drone1 \\
      --throttle-preset 1100 \\
      --baselines-dir app-data/baselines
"""
import argparse
import json
import sys
from pathlib import Path

from .baseline import average_baselines, load_baseline, save_baseline, save_baseline_profile
from .config import MotorConfig
from .models import BaselineData
from .pipeline import DiagnosticPipeline, PipelineInput
from .preprocessing import load_segment
from .spectral import compute_welch_psd


def cmd_analyze(args: argparse.Namespace) -> None:
    motor_config = MotorConfig(
        n_poles=args.n_poles,
        n_rotor_slots=args.n_rotor_slots,
        bpfo_ratio=args.bpfo_ratio,
        bpfi_ratio=args.bpfi_ratio,
    )
    inp = PipelineInput(
        wav_path=args.wav,
        baseline_npz_path=args.baseline_npz,
        drone_id=args.drone_id,
        throttle_preset=args.throttle_preset,
        baselines_dir=args.baselines_dir,
        start_s=args.start,
        end_s=args.end,
        motor_name=args.motor_name,
        motor_config=motor_config,
        output_dir=args.output_dir,
        test_id=args.test_id,
        microphone_name=args.mic,
        app_version=args.app_version,
        analysis_version="1.0.0",
    )
    pipeline = DiagnosticPipeline()
    state = pipeline.run(inp)

    # Emit the result JSON to stdout for Electron to capture
    result_path = state.artifacts.result_json_path if state.artifacts else None
    output = {
        "status": "ok",
        "test_id": state.test_id,
        "overall_status": state.diagnostic.overall_status if state.diagnostic else None,
        "result_json_path": str(result_path) if result_path else None,
        "artifacts": state.artifacts.to_dict() if state.artifacts else None,
    }
    print(json.dumps(output))


def cmd_baseline_gen(args: argparse.Namespace) -> None:
    pre = load_segment(args.wav, args.start, args.end)
    spectral = compute_welch_psd(pre)
    out_path = save_baseline(spectral, args.out)
    print(json.dumps({"status": "ok", "path": str(out_path)}))


def cmd_baseline_avg(args: argparse.Namespace) -> None:
    spectral_list = [load_baseline(p) for p in args.npz]
    averaged = average_baselines(spectral_list)
    baseline = BaselineData(
        drone_id=args.drone_id,
        throttle_preset=args.throttle_preset,
        freqs=averaged.freqs,
        psd_db=averaged.psd_db,
        capture_count=len(spectral_list),
    )
    out_path = save_baseline_profile(baseline, args.baselines_dir)
    print(json.dumps({
        "status": "ok",
        "path": str(out_path),
        "capture_count": len(spectral_list),
    }))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m analysis.api",
        description="Drone motor diagnostic analysis sidecar",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── analyze ────────────────────────────────────────────────────────────
    p_analyze = sub.add_parser("analyze", help="Run full diagnostic pipeline")
    p_analyze.add_argument("--wav", required=True, help="Path to WAV file")
    p_analyze.add_argument("--baseline-npz", help="Path to baseline .npz file")
    p_analyze.add_argument("--drone-id", help="Drone ID (for named baseline lookup)")
    p_analyze.add_argument("--throttle-preset", help="Throttle preset name")
    p_analyze.add_argument("--baselines-dir", help="Baselines root directory")
    p_analyze.add_argument("--output-dir", required=True, help="Output directory for artifacts")
    p_analyze.add_argument("--start", type=float, default=2.0, help="Trim start (s)")
    p_analyze.add_argument("--end", type=float, default=8.0, help="Trim end (s)")
    p_analyze.add_argument("--motor-name", default="Motor", help="Motor label")
    p_analyze.add_argument("--test-id", help="Test ID (UUID generated if omitted)")
    p_analyze.add_argument("--mic", help="Microphone name for metadata")
    p_analyze.add_argument("--app-version", help="App version for metadata")
    p_analyze.add_argument("--n-poles", type=int, default=7)
    p_analyze.add_argument("--n-rotor-slots", type=int, default=12)
    p_analyze.add_argument("--bpfo-ratio", type=float, default=3.0)
    p_analyze.add_argument("--bpfi-ratio", type=float, default=5.0)

    # ── baseline-gen ───────────────────────────────────────────────────────
    p_gen = sub.add_parser("baseline-gen", help="Generate one baseline npz from WAV")
    p_gen.add_argument("--wav", required=True)
    p_gen.add_argument("--out", required=True, help="Output .npz path")
    p_gen.add_argument("--start", type=float, default=2.0)
    p_gen.add_argument("--end", type=float, default=8.0)

    # ── baseline-avg ───────────────────────────────────────────────────────
    p_avg = sub.add_parser("baseline-avg", help="Average multiple baselines into a profile")
    p_avg.add_argument("--npz", nargs="+", required=True, help="Input .npz files")
    p_avg.add_argument("--drone-id", required=True)
    p_avg.add_argument("--throttle-preset", required=True)
    p_avg.add_argument("--baselines-dir", required=True)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "analyze":
            cmd_analyze(args)
        elif args.command == "baseline-gen":
            cmd_baseline_gen(args)
        elif args.command == "baseline-avg":
            cmd_baseline_avg(args)
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
