@echo off
REM Build the Python analysis sidecar as a standalone Windows executable.
REM Run this from the repo root or from the analysis-sidecar directory.
REM
REM Prerequisites:
REM   pip install pyinstaller
REM   pip install -r analysis/requirements.txt

setlocal enabledelayedexpansion

echo === Analysis Sidecar Build ===

REM Navigate to repo root regardless of where the script is called from
pushd "%~dp0.."

REM Check pyinstaller is available
python -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: pyinstaller not found. Run: pip install pyinstaller
    exit /b 1
)

echo Building analysis_sidecar.exe...
python -m PyInstaller analysis-sidecar/build.spec --clean ^
    --distpath analysis-sidecar/dist ^
    --workpath analysis-sidecar/build

if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    popd
    exit /b 1
)

echo.
echo Build complete: analysis-sidecar\dist\analysis_sidecar.exe
echo.
echo Smoke-testing the exe...
analysis-sidecar\dist\analysis_sidecar.exe list-devices
echo.
echo Next steps:
echo   cd desktop ^&^& npm run dist
echo.

popd
endlocal
