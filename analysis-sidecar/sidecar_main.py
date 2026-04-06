"""
PyInstaller entry-point for the analysis sidecar.

This thin wrapper imports and runs analysis.api.main() so that PyInstaller
can find a concrete script file as its entry point, while the actual
implementation lives in the analysis package.

Usage (dev):
    python analysis-sidecar/sidecar_main.py analyze --wav run.wav ...

Build:
    pyinstaller analysis-sidecar/build.spec --clean
"""
import sys
import os

# Ensure the repo root is on sys.path so `analysis` package is importable.
# When running via PyInstaller, the frozen executable already has everything
# bundled, so this only matters during development / testing.
_here = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.dirname(_here)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from analysis.api import main  # noqa: E402

if __name__ == "__main__":
    main()
