# Implementation Agent Prompt

You are building a new repository for a Windows-first drone motor diagnostic desktop app.

Use the following requirements and constraints exactly.

## Product goal

Build a desktop application that can:

- connect to a Betaflight flight controller over USB/serial
- temporarily configure a safe motor-test session
- run motors in a controlled sequence at preset throttle levels
- record audio from a USB microphone
- process the audio using a modular sound-analysis pipeline
- save complete local logs and artifacts offline first
- upload processed results and artifacts to Supabase when connectivity returns

The app must be installable on another Windows machine using one installer EXE. That target machine should not need Betaflight App, Python, or Docker installed.

## Core architectural decisions

### Desktop app

- Use `Electron + React + TypeScript`.
- Windows-first.
- Produce an installer EXE.

### Analysis runtime

- Reuse the current Python analysis logic as the starting point.
- The best source file is the old repo's `Sound/sound_final_design_2.py`.
- Refactor that logic into separate modules without changing the actual diagnostic behavior.
- Bundle the Python analysis runtime as a packaged local sidecar.
- Do not use Docker at end-user runtime.
- Docker is allowed only for development/CI convenience.

### Betaflight integration

- Do not require Betaflight App/Configurator on the target machine.
- Do not fork Betaflight firmware unless absolutely necessary.
- Assume the drone already runs stock Betaflight firmware.
- Communicate directly with the flight controller from the app over serial/MSP.
- The app must temporarily apply test-session settings and restore the pre-test settings afterward.
- The app must ensure all motors are off when the session ends.

## Recording and analysis requirements

### Audio

- Record WAV for analysis.
- Allow optional MP3 export.
- Do not use MP3 as the primary analysis format.

### Analysis pipeline separation

Create separate Python modules for:

- preprocessing
- spectral analysis / FFT / PSD
- post-processing / diagnostic classification
- plots
- baselines
- pipeline orchestration
- models
- reporting

Refactor the behavior from `sound_final_design_2.py` into a package shaped roughly like:

```text
analysis/
  api.py
  baseline.py
  config.py
  models.py
  pipeline.py
  plots.py
  postprocessing.py
  preprocessing.py
  reporting.py
  spectral.py
```

### Keep functionality stable

- Preserve the current thresholds and formulas unless a change is explicitly justified.
- Preserve the current fault-check logic as the baseline behavior.
- Preserve the current graph intent.
- Do not rewrite the analysis from scratch if direct extraction/refactoring is possible.

### Allowed low-risk improvements

- compute baseline interpolation once per run
- cache repeated frequency-band masks
- separate plotting from analysis logic
- replace loose dictionaries with typed models/dataclasses
- expose stage-by-stage pipeline execution

## Diagnostic outputs

Each run must store locally:

1. timestamp with at least 1-second resolution
2. unique test identifier
3. final diagnostic classification and detailed results
4. preprocessed diagnostic data and FFT/PSD data
5. pre-FFT graph and post-FFT graph

Default graph definitions:

- pre-FFT graph = waveform/time-domain graph
- post-FFT graph = PSD graph

Diagnostic presentation in the app must emphasize:

- one overall final classification
- detailed fault results underneath

## Test workflow requirements

### Supported modes

- full sequential test of all motors on the drone
- single-motor rerun mode

### Presets

Each preset should lock:

- motor or sequence
- throttle value
- duration
- cooldown
- microphone

### Throttle safety

- Support multiple throttle presets.
- Default safety threshold is `1200` on the Betaflight `1000-2000` scale.
- If a preset exceeds `1200`, the app must show a confirmation gate warning that props must be removed.

### Control flow

- Use a safe automatic workflow.
- Also allow manual override if something goes wrong.
- Include a prominent on-screen emergency stop.
- Use automatic timeout/stop behavior on every run.

## Baseline management

- Baselines are per drone.
- Baselines are also per throttle preset.
- Within a drone/throttle profile, use one shared healthy reference across motors.
- New drone/throttle baseline onboarding uses a 5-run average.

Build a baseline workflow that:

- creates a drone profile
- selects a throttle preset
- records five healthy runs
- averages them into a stored baseline profile

## Persistence design

### Local

Use:

- SQLite for metadata and queue state
- local filesystem for artifacts

Store artifacts in a structure similar to:

```text
app-data/
  db/
    diagnostics.sqlite
  runs/
    <test_id>/
      raw_audio.wav
      raw_audio.mp3
      preprocessed_signal.npz
      fft_data.npz
      waveform.png
      psd.png
      result.json
  baselines/
    <drone_id>/
      <throttle_preset>/
        baseline.json
        baseline_preprocessed.npz
        baseline_fft.npz
        baseline_psd.png
```

Create SQLite tables for at least:

- `drone_profiles`
- `throttle_presets`
- `baseline_profiles`
- `diagnostic_runs`
- `upload_jobs`

### Remote

Use Supabase for remote storage.

- Supabase Postgres for metadata
- Supabase Storage for processed artifacts
- shared app auth for the first release

Default upload scope:

- metadata
- final results
- processed data files
- waveform and PSD graphs

Do not upload raw WAV by default.

### Sync behavior

- local completion must succeed even with no internet
- upload must happen later when connectivity returns
- queue pending uploads in SQLite
- retry with backoff
- resume pending uploads after app restart

## Betaflight motor-control requirements

Implement a small motor-control subsystem in the app that can:

- discover/connect to the flight controller
- verify Betaflight compatibility
- capture pre-test configuration snapshot
- apply temporary test-session config
- command individual motors at preset throttle
- stop motors cleanly
- restore the exact pre-test configuration when the run ends or is interrupted

Treat restoration failure as a serious surfaced error.

## UI requirements

Create at minimum:

- test screen
- baseline setup screen
- history screen
- run detail screen
- settings screen

### Test screen

- drone selection
- throttle preset selection
- microphone selection
- run mode selector
- live status by pipeline stage
- emergency stop
- high-throttle warning/confirmation when needed

### Baseline setup screen

- create or select drone profile
- choose throttle preset
- execute five healthy captures
- show averaging progress and completion

### History screen

- timestamp
- test ID
- drone ID
- throttle preset
- final classification
- sync status

### Run detail screen

- overall status
- per-fault results
- waveform graph
- PSD graph
- artifact access
- sync attempts and errors

### Settings screen

- Supabase config
- local storage path
- default safety settings
- default microphone behavior

## Testing requirements

Add automated coverage for:

- preprocessing
- spectral helpers
- post-processing rules
- baseline averaging
- queue state transitions
- Electron-to-analysis integration
- artifact creation
- offline-to-online sync behavior

Manually verify:

- full motor sequence
- single-motor rerun
- emergency stop
- Betaflight config restoration
- high-throttle confirmation flow
- baseline onboarding

## Deliverables

Build the new repository with:

- Electron desktop app scaffold
- modular Python analysis package
- packaged local analysis sidecar integration
- Betaflight serial/MSP control layer
- SQLite persistence
- Supabase sync worker
- core UI screens
- documentation for setup, packaging, and operation

## Important constraints

- Do not make the product depend on Docker at runtime.
- Do not make the product depend on Betaflight App/Configurator being installed.
- Do not materially change the existing diagnostic behavior unless clearly documented and justified.
- Prefer modular, testable files over monolithic scripts.
- Prioritize safety, offline durability, and recoverability.
