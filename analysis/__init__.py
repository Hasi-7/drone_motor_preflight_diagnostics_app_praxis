"""
Drone Motor Diagnostic Analysis Package

Extracted and modularized from reference/legacy_sound/sound_final_design_2.py.
Behavioral parity with the legacy code is preserved.
"""
from .pipeline import DiagnosticPipeline
from .models import DiagnosticResult, FaultCheckResult, SpectralData, PreprocessedData

__all__ = [
    "DiagnosticPipeline",
    "DiagnosticResult",
    "FaultCheckResult",
    "SpectralData",
    "PreprocessedData",
]
