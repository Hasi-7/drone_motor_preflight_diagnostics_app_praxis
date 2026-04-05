# PyInstaller spec file for the analysis sidecar executable.
#
# Build command (from repo root):
#   pyinstaller analysis-sidecar/build.spec
#
# Output: analysis-sidecar/dist/analysis_sidecar.exe
# This exe is copied into the Electron NSIS installer resources.

import sys
from pathlib import Path

ROOT = Path(SPECPATH).parent  # repo root
ANALYSIS_PKG = str(ROOT / "analysis")

a = Analysis(
    [str(ROOT / "analysis" / "api.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # scipy / librosa dynamic imports
        "scipy.signal",
        "scipy.io",
        "scipy.io.wavfile",
        "librosa",
        "librosa.core",
        "librosa.util",
        "soundfile",
        "sounddevice",
        "matplotlib",
        "matplotlib.backends.backend_agg",
        "numpy",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Keep the exe lean — we don't need a full Qt/Tk stack
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="analysis_sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,   # console=True — sidecar communicates via stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # Output into analysis-sidecar/dist/ so the Electron build can copy it
    distpath=str(ROOT / "analysis-sidecar" / "dist"),
)
