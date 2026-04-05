"""
Audio recording: microphone capture to WAV file.

Used by the sidecar CLI to record motor audio during test and baseline flows.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt
import sounddevice as sd
import soundfile as sf


def list_input_devices() -> list[dict[str, object]]:
    """Return input-capable audio devices suitable for recording.

    Returns a list of dicts with keys: index, name, max_input_channels,
    default_samplerate.
    """
    devices: list[dict[str, object]] = []
    for idx, dev in enumerate(sd.query_devices()):  # type: ignore[call-overload]
        if dev["max_input_channels"] > 0:  # type: ignore[index]
            devices.append(
                {
                    "index": idx,
                    "name": str(dev["name"]),  # type: ignore[index]
                    "max_input_channels": int(dev["max_input_channels"]),  # type: ignore[index]
                    "default_samplerate": float(dev["default_samplerate"]),  # type: ignore[index]
                }
            )
    return devices


def record_wav(
    out_path: str | Path,
    duration: float,
    device: int | str | None = None,
    sample_rate: int = 44100,
    channels: int = 1,
) -> Path:
    """Record audio from a microphone and save to a WAV file.

    Args:
        out_path: Destination WAV file path. Parent dirs are created if needed.
        duration: Recording length in seconds.
        device: sounddevice device index or name. Uses system default if None.
        sample_rate: Sample rate in Hz (default 44100).
        channels: Number of input channels (default 1 — mono).

    Returns:
        Absolute Path to the written WAV file.

    Raises:
        sounddevice.PortAudioError: If the device cannot be opened.
        ValueError: If duration <= 0.
    """
    if duration <= 0:
        raise ValueError(f"duration must be positive, got {duration}")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    n_frames = int(duration * sample_rate)
    audio: npt.NDArray[np.float32] = sd.rec(  # type: ignore[call-overload]
        n_frames,
        samplerate=sample_rate,
        channels=channels,
        dtype="float32",
        device=device,
    )
    sd.wait()

    sf.write(str(out_path), audio, sample_rate, subtype="PCM_16")
    return out_path.resolve()
