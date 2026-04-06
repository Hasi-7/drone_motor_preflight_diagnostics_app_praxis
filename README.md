# Drone Motor Preflight Diagnostics

A Windows desktop app for diagnosing brushless drone motors before flight — no props, no guesswork. Records audio during a motor run, runs spectral analysis against a known-good baseline, and flags faults before you fly.

---

## What It Does

- Connects directly to a Betaflight flight controller over USB (MSP protocol — no Betaflight app needed)
- Spins individual motors at configurable throttle
- Records audio via a microphone placed near the motor
- Runs FFT-based spectral analysis to detect bearing wear, imbalance, and harmonic anomalies
- Compares results against a per-drone baseline profile
- Syncs run history to Supabase (optional)

---

## Installation

Download the installer from the [releases](#) section:

```
Drone Motor Diagnostics Setup 0.1.0.exe
```

Run the installer — no Python, no extra runtimes required. Everything is bundled.

**System requirements:**
- Windows 10 / 11 (64-bit)
- USB port for flight controller
- Microphone (USB or built-in)

---

## First-Time Setup

### 1. Connect your flight controller
Plug in the FC via USB. The app will list available serial ports — select the correct COM port in Settings.

### 2. Create a baseline
Before you can diagnose motors, you need a healthy reference recording for each drone:

1. Go to the **Baseline** screen
2. Select a drone and throttle preset
3. Record 5 captures from a motor in known-good condition
4. Click **Average Baselines** — the app generates a per-drone/per-throttle profile (minimum 3 captures required)

### 3. Run a preflight test
1. Go to the **Test** screen
2. Select motor, throttle, and microphone
3. **Confirm props are removed** when prompted (required for throttle > 1200)
4. Hit **Start Test** — the app spins the motor and records simultaneously
5. Results appear on the **Run Detail** screen with pass/warn/fail per fault check

---

## Fault Checks

The analysis pipeline runs 8 checks on every recording:

| Check | What It Catches |
|-------|----------------|
| Shaft frequency detection | Motor not spinning / wrong RPM |
| Harmonic distortion | Bearing wear, bent shaft |
| Sub-harmonic content | Imbalance, loose propeller adapter |
| Band noise (low / mid / high) | Electrical noise, winding faults |
| Spectral flatness | Broadband noise floor elevation |
| Peak-to-baseline delta | Overall health vs. reference |
| Sideband symmetry | Mechanical looseness |
| Resonance spikes | Frame resonance, resonant frequencies |

Thresholds: **WARN** at 6 dB above baseline, **CRIT** at 12 dB.

---

## Safety

- The **Emergency Stop** button is always visible during a motor run
- Throttle > 1200 µs requires a modal confirmation that propellers are removed
- Every motor run has an auto-timeout
- Betaflight config is restored after every session — EEPROM is never written unless you explicitly request it

---

## Screens

| Screen | Purpose |
|--------|---------|
| Test | Run a single-motor diagnostic |
| Baseline | Capture and manage healthy reference profiles |
| History | Browse all past runs |
| Run Detail | Full fault report and sync status for a single run |
| Settings | Serial port, Supabase credentials, microphone |

---

## Optional: Supabase Sync

To sync run history to the cloud:

1. Create a free project at [supabase.com](https://supabase.com)
2. Create the required tables (schema in `supabase/`)
3. Enter your Project URL and anon key in the **Settings** screen

Sync is non-blocking — the app queues uploads and retries in the background.

---

## Building From Source

### Prerequisites

- Node.js 20–23 + npm 10+
- Python 3.11+
- PyInstaller: `pip install pyinstaller`
- Python dependencies: `pip install -r analysis/requirements.txt`

### Step 1 — Build the Python sidecar

```bat
analysis-sidecar\build.bat
```

This produces `analysis-sidecar\dist\analysis_sidecar.exe`. Smoke-test it:

```bat
analysis-sidecar\dist\analysis_sidecar.exe list-devices
```

### Step 2 — Build the Electron installer

```bash
cd desktop
npm install
npm run dist
```

The installer is written to `desktop/release/`.

### Development mode

```bash
cd desktop
npm install
npm run dev        # starts renderer (Vite) + main process (tsc --watch)
npm run electron   # in a second terminal
```

---

## Repository Layout

```
analysis/               Python analysis package (FFT pipeline, 48 tests)
  api.py                  CLI entry point (analyze / baseline-gen / baseline-avg / record / list-devices)
  pipeline.py             6-stage DiagnosticPipeline
  postprocessing.py       8 fault checks
  spectral.py             Welch PSD, shaft frequency, peak/band helpers
  baseline.py             Baseline save/load/average
  recording.py            Microphone capture (sounddevice + soundfile)
  tests/                  pytest suite

analysis-sidecar/       PyInstaller packaging
  sidecar_main.py         Thin entry point
  build.spec              PyInstaller spec
  build.bat               Windows build script
  dist/                   Built exe (not committed)

desktop/                Electron + React app
  src/main/               Main process (IPC, Betaflight, SQLite, sidecar spawn)
  src/renderer/           React UI (5 screens)
  src/shared/             Shared TypeScript types + preload API interface
  release/                Built installer (not committed)

supabase/               Remote schema
reference/              Legacy behavioral reference (do not modify)
```

---

## License

MIT
