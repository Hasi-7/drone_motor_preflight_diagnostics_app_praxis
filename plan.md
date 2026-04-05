# Motor Diagnostic Desktop App Plan

## Objective

Build a Windows-first desktop application for drone motor diagnostics that:

- controls motors through stock Betaflight firmware without requiring Betaflight App on the target machine
- records motor audio from a USB microphone
- runs the sound-analysis pipeline as separate preprocessing, spectral, and post-processing stages
- stores complete local diagnostic logs and artifacts offline first
- uploads processed results and artifacts to Supabase when connectivity is available
- ships as a normal Windows installer EXE with no separate Python or Docker install required

## Final Architecture Decisions

### Runtime model

- Ship a Windows installer EXE.
- Use `Electron + React + TypeScript` for the desktop app.
- Bundle a local packaged Python analysis sidecar with the installer.
- Do not depend on Docker at end-user runtime.
- Docker may still be used in development/CI to standardize analysis builds and tests.

### Why not Docker at runtime

Docker makes the two hardware-heavy parts of this product more fragile:

- USB microphone access
- Betaflight serial/MSP communication to the flight controller

Bundling the analysis locally is simpler for installation, safer for field use, and avoids requiring Docker Desktop on every Windows machine.

### Betaflight integration

- The drone continues to run stock Betaflight firmware.
- The app talks directly to the flight controller over serial/MSP.
- The target machine should only need this app installed.
- The app owns the motor-test workflow and must not require Betaflight App/Configurator.

### Audio format

- Record WAV for analysis.
- Allow optional MP3 export.
- Do not use MP3 as the primary analysis format.

### Baselines

- Baselines are stored per drone.
- Baselines are also stored per throttle preset.
- Each drone/throttle profile uses one shared healthy reference across motors.
- New baseline onboarding uses a 5-run average.

### Remote sync model

- Local system is the source of truth during acquisition.
- Use SQLite locally for metadata, queue state, and file references.
- Use local files for heavy artifacts.
- Sync processed artifacts and metadata to Supabase when online.
- Use shared app auth for the first release.

## User Workflow

### Full drone test

1. Operator selects the drone profile and a throttle preset.
2. App connects to the Betaflight flight controller.
3. App captures the current relevant Betaflight configuration for restoration later.
4. App applies the temporary test configuration required for safe bench testing.
5. App runs each motor sequentially using the preset:
   - select motor
   - apply throttle
   - record for preset duration
   - stop motor
   - wait for cooldown / spin-down
6. App restores the pre-test Betaflight settings.
7. App processes each run through:
   - preprocessing
   - spectral analysis
   - post-processing / classification
8. App writes the local log and artifacts.
9. App queues the processed results for remote upload.

### Single-motor rerun

- Same flow as above, but for one selected motor only.
- Used for troubleshooting or retesting without running the whole sequence.

### Baseline onboarding

1. Operator creates a new drone profile.
2. Operator chooses a throttle preset.
3. App runs 5 healthy captures.
4. App averages those healthy captures into the baseline profile for that drone/throttle combination.
5. Baseline artifacts and metadata are stored locally and can later sync remotely.

## Safety Requirements

- The UI must include a prominent on-screen emergency stop.
- Every motor run must have an automatic timeout.
- The app must support manual override if the automatic workflow misbehaves.
- Throttle commands above `1200` must trigger a confirmation gate warning that props must be removed.
- Temporary test-session Betaflight configuration must always be restored after the run.
- Motors must always be returned to off state before the session ends.
- If restoration fails, the app must clearly surface the failure and block silent exit.

## Existing Code Starting Point

The best source file in this repository is `Sound/sound_final_design_2.py`.

It already contains:

- audio loading
- Welch PSD generation
- shaft frequency detection
- baseline comparison
- multiple fault checks
- report generation
- plot generation

The new repo should treat that file as the source of diagnostic behavior, but not keep it as a monolith.

## Analysis Refactor Plan

The current sound logic should be separated into behavior-preserving modules.

### Proposed analysis package layout

```text
analysis/
  __init__.py
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

### Module responsibilities

#### `preprocessing.py`

- load WAV input
- trim to the analysis window
- convert channel layout if needed
- normalize signal representation
- optional light validation and denoise/filter hooks

Initial mapping from current code:

- `load_segment`

#### `spectral.py`

- Welch PSD generation
- spectral helper functions
- shaft-frequency detection
- reusable band and peak helpers

Initial mapping from current code:

- `compute_welch_psd`
- `find_shaft_frequency`
- `peak_db_near`
- `band_avg_db`

#### `postprocessing.py`

- convert spectral differences into fault decisions
- run the fault checks
- compute final classification

Initial mapping from current code:

- `status_from_deviation`
- all `check_*` functions
- `run_all_checks`

#### `plots.py`

- waveform plot generation
- PSD/FFT comparison plots
- image export to disk

Initial mapping from current code:

- `plot_time`
- `plot_psd`

#### `baseline.py`

- baseline save/load
- baseline averaging for onboarding
- baseline profile resolution by drone + throttle preset

Initial mapping from current code:

- `save_baseline`
- `load_baseline`

#### `reporting.py`

- user-facing summary generation
- structured text/JSON result rendering

Initial mapping from current code:

- `print_report`

#### `pipeline.py`

- orchestration only
- no UI and no plotting side effects unless requested
- expose stage-by-stage execution for the desktop app

Suggested pipeline stages:

1. ingest
2. preprocess
3. spectral
4. compare to baseline
5. classify
6. render artifacts
7. persist results

### Low-risk efficiency improvements

These should not materially change functionality if implemented carefully:

- compute baseline interpolation once per run instead of multiple times
- cache repeated frequency masks for fault checks within a run
- separate plotting from analysis so headless execution is faster
- replace loose nested dictionaries with typed models/dataclasses
- move CLI code out of the analysis modules
- allow stage-level execution to avoid rerunning the entire pipeline during testing/debugging

## Desktop App Structure

### Proposed repo layout

```text
repo/
  desktop/
    src/
      main/
        ipc/
        services/
      renderer/
        pages/
        components/
        hooks/
        lib/
  analysis/
  shared/
  docs/
```

### Electron responsibilities

#### Main process

- serial/MSP communication with Betaflight
- microphone access orchestration if implemented through desktop APIs
- launching and managing the analysis sidecar
- SQLite access
- filesystem artifact management
- sync worker
- crash-safe state management

#### Renderer

- record/test workflow UI
- baseline onboarding UI
- history and run-detail screens
- sync status UI
- settings

### Core UI screens

#### Test screen

- drone selection
- throttle preset selection
- microphone selection
- run mode selector: full sequence or single motor rerun
- live stage status
- emergency stop
- warnings for high throttle

#### Baseline setup screen

- create or edit drone profile
- choose throttle preset
- run 5-capture onboarding
- show baseline generation progress

#### History screen

- timestamp
- test ID
- drone ID
- throttle preset
- final classification
- sync status

#### Run detail screen

- overall status
- per-fault diagnostic results
- waveform graph
- PSD graph
- artifact list
- upload attempts / sync errors

#### Settings screen

- Supabase endpoint and app auth configuration
- local storage location
- microphone defaults
- throttle safety limits

## Betaflight Motor-Control Design

### Control approach

- Communicate directly with stock Betaflight firmware over serial/MSP.
- Do not rely on Betaflight App being installed.
- Build a small motor-control layer in the app responsible for test-session setup, execution, and restoration.

### Required capabilities

- discover and connect to the flight controller
- verify Betaflight compatibility
- read the current relevant config before a test
- apply temporary test-specific config
- drive individual motors at preset throttle levels
- stop motors cleanly
- restore previous config after testing

### Session behavior

- Apply test-session settings temporarily only.
- Restore the pre-test settings after completion or interruption.
- Ensure motor spin direction and related test settings are not permanently changed unless the operator explicitly chooses an onboarding/configuration action in the future.

### Presets

Each preset should define:

- target motor sequence or single motor
- throttle value
- duration
- cooldown
- preferred microphone

### Throttle policy

- Multiple throttle levels are supported.
- Values above `1200` require explicit operator confirmation that props are removed.
- App settings should expose a configurable safety threshold, defaulting to `1200`.

## Local Persistence Design

### Why SQLite locally

SQLite is a good fit because runs are mostly append-only, created on one workstation, and need durable offline storage without a background server.

Use SQLite for:

- run metadata
- baseline metadata
- upload queue state
- retry/error tracking
- file path references
- app settings where appropriate

Use the filesystem for:

- WAV recordings
- optional MP3 exports
- processed arrays
- plots
- JSON results

### Suggested artifact layout

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

### Suggested SQLite tables

#### `drone_profiles`

- `id`
- `drone_id`
- `display_name`
- `notes`
- `created_at`
- `updated_at`

#### `throttle_presets`

- `id`
- `name`
- `throttle_value`
- `duration_ms`
- `cooldown_ms`
- `mic_name`
- `requires_high_throttle_confirm`
- `created_at`
- `updated_at`

#### `baseline_profiles`

- `id`
- `drone_id`
- `throttle_preset_id`
- `capture_count`
- `baseline_result_path`
- `baseline_preprocessed_path`
- `baseline_fft_path`
- `baseline_plot_path`
- `created_at`
- `updated_at`

#### `diagnostic_runs`

- `id`
- `test_id`
- `drone_id`
- `motor_label`
- `run_mode`
- `throttle_preset_id`
- `recorded_at`
- `completed_at`
- `microphone_name`
- `overall_status`
- `final_classification`
- `results_json_path`
- `raw_wav_path`
- `raw_mp3_path`
- `preprocessed_data_path`
- `fft_data_path`
- `waveform_graph_path`
- `psd_graph_path`
- `sync_status`
- `retry_count`
- `last_sync_error`
- `created_at`
- `updated_at`

#### `upload_jobs`

- `id`
- `test_id`
- `status`
- `attempt_count`
- `next_retry_at`
- `last_error`
- `created_at`
- `updated_at`

## Local Log Requirements

Each local diagnostic record must contain at minimum:

1. timestamp with at least 1-second resolution
2. unique test identifier
3. final diagnostic classification and results
4. preprocessed diagnostic data and FFT data
5. pre-FFT graph and post-FFT graph

Recommended additional fields:

- drone ID
- motor label
- throttle preset
- microphone name
- app version
- analysis version
- sync status
- restoration success/failure for Betaflight session config

## Remote Sync Design

### Why SQLite local + Supabase remote

The workstation needs to work fully offline while collecting data. That means local writes must succeed even if the network is down.

The best split is:

- SQLite locally for durable metadata and queueing
- local files for artifacts
- Supabase Postgres for remote metadata
- Supabase Storage for processed artifacts

### Default remote upload scope

Upload by default:

- metadata
- final results
- processed data files
- waveform and PSD graphs

Do not upload raw WAV by default.

### Sync workflow

1. Complete the local run first.
2. Insert or update the queue record in SQLite.
3. Background worker checks connectivity.
4. Upload artifacts to Supabase Storage.
5. Upsert metadata into Supabase Postgres.
6. Mark the local record as synced.
7. Retry failures with backoff.

### Why a sync-first database is not needed here

Heavy sync-first databases are most useful when multiple devices can edit the same records offline and later need conflict resolution.

This product does not currently need that model because:

- runs are created on one workstation
- runs are mostly immutable after completion
- the main problem is delayed upload, not concurrent editing

That makes SQLite plus a simple upload queue much lower complexity and easier to validate.

## Packaged Analysis Sidecar

### Recommended implementation

- Package the Python analysis code as a local executable or embedded runtime.
- Launch it from Electron main.
- Expose a local API or CLI contract for:
  - preprocess
  - analyze
  - baseline generation
  - artifact export

### Interface options

#### Preferred

- local CLI or stdin/stdout job contract for simpler packaging

#### Also acceptable

- local FastAPI service started by the app at runtime

### Required outputs per run

- structured JSON result
- preprocessed data file
- FFT/PSD data file
- waveform plot
- PSD plot

## Packaging and Installation

- Produce a Windows installer EXE.
- Installer bundles Electron app and analysis sidecar.
- No separate installation of Python, Docker, or Betaflight App should be required.
- App should validate missing drivers or unavailable serial/audio devices on first launch.

## Testing Strategy

### Unit tests

- preprocessing functions
- spectral helpers
- diagnostic rules
- baseline averaging logic
- queue state transitions
- Betaflight config snapshot/restore logic where possible

### Integration tests

- Electron IPC to analysis sidecar
- SQLite persistence
- artifact creation
- offline to online sync transitions
- full-sequence preset execution flow
- single-motor rerun flow

### Manual validation

- microphone selection and recording
- full multi-motor sequence
- single-motor rerun
- emergency stop
- config restoration after success
- config restoration after interruption
- high-throttle confirmation flow
- baseline onboarding with 5-run average

## Implementation Order

1. Create the new repo and scaffold Electron desktop app.
2. Extract the current sound logic into modular Python analysis package.
3. Define shared typed contracts for runs, baselines, and results.
4. Build local artifact and SQLite persistence layer.
5. Implement analysis sidecar execution from Electron.
6. Implement Betaflight serial/MSP control layer.
7. Build baseline onboarding flow.
8. Build full-sequence and single-motor test flows.
9. Add sync worker and Supabase integration.
10. Add packaging, validation, and documentation.

## Acceptance Criteria

- A Windows machine can install the app from one installer EXE.
- The machine does not need Betaflight App, Python, or Docker installed.
- The app can connect to a Betaflight-controlled drone and run temporary motor-test sessions.
- The app restores pre-test Betaflight settings after test completion or interruption.
- The app records WAV audio and can optionally export MP3.
- The analysis pipeline is separated into preprocessing, spectral, and post-processing modules.
- The app stores local logs and required artifacts for every run.
- The app supports per-drone, per-throttle baseline profiles using a 5-run average.
- The app can work offline and later sync processed results and artifacts to Supabase.
- The UI exposes overall classification plus detailed fault results, waveform graph, and PSD graph.
