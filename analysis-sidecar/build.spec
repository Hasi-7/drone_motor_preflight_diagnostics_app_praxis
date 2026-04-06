# PyInstaller spec file for the analysis sidecar executable.
#
# Build command (from repo root):
#   python -m PyInstaller analysis-sidecar/build.spec --clean \
#       --distpath analysis-sidecar/dist \
#       --workpath analysis-sidecar/build
#
# Or simply run:
#   analysis-sidecar\build.bat
#
# Output: analysis-sidecar/dist/analysis_sidecar.exe
# Bundled into the Electron NSIS installer via extraResources.

from pathlib import Path

ROOT = Path(SPECPATH).parent  # repo root

a = Analysis(
    [str(ROOT / "analysis-sidecar" / "sidecar_main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # scipy — dynamic import of C extension modules
        "scipy.signal",
        "scipy.io",
        "scipy.io.wavfile",
        "scipy.signal.windows",
        # librosa and its dependencies
        "librosa",
        "librosa.core",
        "librosa.util",
        "librosa.filters",
        "audioread",
        # sounddevice / soundfile for recording
        "soundfile",
        "sounddevice",
        # matplotlib — non-interactive backend
        "matplotlib",
        "matplotlib.backends.backend_agg",
        "matplotlib.figure",
        # numpy
        "numpy",
        "numpy.core",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Strip heavy GUI toolkits — the sidecar is headless
        "tkinter",
        "_tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "wx",
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
    # console=True: the sidecar communicates via stdout/stderr, needs a console
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
