/**
 * SidecarService — manages the packaged Python analysis sidecar.
 *
 * The sidecar is a PyInstaller-bundled executable (or a Python environment)
 * located in the analysis-sidecar directory. Electron spawns it as a child
 * process for each analysis job and reads the JSON result from stdout.
 *
 * Contract:
 *   - Each invocation is a one-shot CLI call
 *   - JSON result is printed to stdout on success
 *   - Errors are printed to stderr and process exits with code 1
 */
import { ChildProcess, spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export interface SidecarAnalyzeArgs {
  wavPath: string;
  baselineNpzPath?: string;
  droneId?: string;
  throttlePreset?: string;
  baselinesDir?: string;
  outputDir: string;
  startS?: number;
  endS?: number;
  motorName?: string;
  testId?: string;
  micName?: string;
  appVersion?: string;
  nPoles?: number;
  nRotorSlots?: number;
  bpfoRatio?: number;
  bpfiRatio?: number;
}

export interface SidecarBaselineGenArgs {
  wavPath: string;
  outPath: string;
  startS?: number;
  endS?: number;
}

export interface SidecarBaselineAvgArgs {
  npzPaths: string[];
  droneId: string;
  throttlePreset: string;
  baselinesDir: string;
}

export interface SidecarRecordArgs {
  outPath: string;
  duration: number;
  deviceIndex?: number;
  sampleRate?: number;
  channels?: number;
}

export class SidecarService {
  private readonly sidecarDir: string;
  private readonly appDataDir: string;
  private runningProcesses: Set<ChildProcess> = new Set();
  // Cached after first successful dev-mode import check so we pay the
  // ~1-2s Python startup cost once per app session, not once per call.
  private devEnvVerified = false;

  constructor(sidecarDir: string, appDataDir: string) {
    this.sidecarDir = sidecarDir;
    this.appDataDir = appDataDir;
  }

  shutdown(): void {
    for (const proc of this.runningProcesses) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.runningProcesses.clear();
  }

  // ── Analyze ──────────────────────────────────────────────────────────

  async analyze(args: SidecarAnalyzeArgs): Promise<unknown> {
    const cliArgs = ["analyze", "--wav", args.wavPath, "--output-dir", args.outputDir];

    if (args.baselineNpzPath) cliArgs.push("--baseline-npz", args.baselineNpzPath);
    if (args.droneId) cliArgs.push("--drone-id", args.droneId);
    if (args.throttlePreset) cliArgs.push("--throttle-preset", args.throttlePreset);
    if (args.baselinesDir) cliArgs.push("--baselines-dir", args.baselinesDir);
    if (args.startS !== undefined) cliArgs.push("--start", String(args.startS));
    if (args.endS !== undefined) cliArgs.push("--end", String(args.endS));
    if (args.motorName) cliArgs.push("--motor-name", args.motorName);
    if (args.testId) cliArgs.push("--test-id", args.testId);
    if (args.micName) cliArgs.push("--mic", args.micName);
    if (args.appVersion) cliArgs.push("--app-version", args.appVersion);
    if (args.nPoles) cliArgs.push("--n-poles", String(args.nPoles));
    if (args.nRotorSlots) cliArgs.push("--n-rotor-slots", String(args.nRotorSlots));
    if (args.bpfoRatio) cliArgs.push("--bpfo-ratio", String(args.bpfoRatio));
    if (args.bpfiRatio) cliArgs.push("--bpfi-ratio", String(args.bpfiRatio));

    return this.runSidecar(cliArgs);
  }

  // ── Baseline generation ───────────────────────────────────────────────

  async generateBaseline(args: SidecarBaselineGenArgs): Promise<unknown> {
    const cliArgs = ["baseline-gen", "--wav", args.wavPath, "--out", args.outPath];
    if (args.startS !== undefined) cliArgs.push("--start", String(args.startS));
    if (args.endS !== undefined) cliArgs.push("--end", String(args.endS));
    return this.runSidecar(cliArgs);
  }

  // ── Baseline averaging ────────────────────────────────────────────────

  async averageBaselines(args: SidecarBaselineAvgArgs): Promise<unknown> {
    const cliArgs = [
      "baseline-avg",
      "--npz", ...args.npzPaths,
      "--drone-id", args.droneId,
      "--throttle-preset", args.throttlePreset,
      "--baselines-dir", args.baselinesDir,
    ];
    return this.runSidecar(cliArgs);
  }

  // ── Audio device listing ──────────────────────────────────────────────

  async listDevices(): Promise<unknown> {
    return this.runSidecar(["list-devices"]);
  }

  // ── Audio recording ───────────────────────────────────────────────────

  async recordAudio(args: SidecarRecordArgs): Promise<unknown> {
    const cliArgs = ["record", "--out", args.outPath, "--duration", String(args.duration)];
    if (args.deviceIndex !== undefined) cliArgs.push("--device", String(args.deviceIndex));
    if (args.sampleRate !== undefined) cliArgs.push("--sample-rate", String(args.sampleRate));
    if (args.channels !== undefined) cliArgs.push("--channels", String(args.channels));
    return this.runSidecar(cliArgs);
  }

  // ── Internal: spawn and collect stdout ───────────────────────────────

  private async runSidecar(args: string[]): Promise<unknown> {
    const { executable, moduleArgs, cwd, env } = this.resolveSidecarCommand(args);

    return new Promise((resolve, reject) => {
      const proc = spawn(executable, moduleArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
        env,
      });
      this.runningProcesses.add(proc);

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("close", (code) => {
        this.runningProcesses.delete(proc);
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error(`Sidecar returned non-JSON output: ${stdout}`));
          }
        } else {
          reject(new Error(`Sidecar exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        this.runningProcesses.delete(proc);
        reject(err);
      });
    });
  }

  /**
   * Resolve the sidecar executable.
   *
   * In a packaged build, the analysis-sidecar directory contains a
   * PyInstaller-compiled exe: analysis-sidecar/analysis_sidecar.exe
   *
   * In development, we require a repo-local virtual environment at .venv/.
   * Using the venv interpreter instead of raw `python` ensures every developer
   * machine uses the same isolated, dependency-complete environment regardless
   * of what is (or isn't) installed globally.
   *
   * On first use the venv interpreter is validated by trying to import all
   * required packages. The check result is cached for the rest of the session.
   */
  private resolveSidecarCommand(cliArgs: string[]): {
    executable: string;
    moduleArgs: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
  } {
    // Packaged: check for compiled exe — no Python environment needed
    const exePath = path.join(this.sidecarDir, "analysis_sidecar.exe");
    if (fs.existsSync(exePath)) {
      return { executable: exePath, moduleArgs: cliArgs, cwd: this.sidecarDir };
    }

    // Development: locate the repo-local venv interpreter
    const repoRoot = path.resolve(this.sidecarDir, "..");
    const isWin = process.platform === "win32";
    const venvPython = isWin
      ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
      : path.join(repoRoot, ".venv", "bin", "python");

    if (!fs.existsSync(venvPython)) {
      const setupCmd = isWin
        ? `python -m venv .venv && .venv\\Scripts\\python -m pip install -r analysis\\requirements.txt`
        : `python3 -m venv .venv && .venv/bin/python -m pip install -r analysis/requirements.txt`;
      throw new Error(
        `Python sidecar environment not found.\n` +
        `Expected interpreter: ${venvPython}\n\n` +
        `Set it up from the repo root:\n  ${setupCmd}`,
      );
    }

    // Verify required packages are importable — runs once per app session.
    // Packages mirror analysis/requirements.txt.
    if (!this.devEnvVerified) {
      const packages = ["numpy", "scipy", "librosa", "matplotlib", "sounddevice", "soundfile"];
      const checkScript = packages.map((p) => `import ${p}`).join("; ");
      const result = spawnSync(venvPython, ["-c", checkScript], { encoding: "utf8" });
      if (result.status !== 0) {
        const installCmd = isWin
          ? `.venv\\Scripts\\python -m pip install -r analysis\\requirements.txt`
          : `.venv/bin/python -m pip install -r analysis/requirements.txt`;
        throw new Error(
          `Python sidecar dependencies are missing or broken.\n` +
          `${(result.stderr ?? "").trim()}\n\n` +
          `Install from the repo root:\n  ${installCmd}`,
        );
      }
      this.devEnvVerified = true;
    }

    const existingPythonPath = process.env["PYTHONPATH"];
    const env = {
      ...process.env,
      PYTHONPATH: existingPythonPath
        ? `${repoRoot}${path.delimiter}${existingPythonPath}`
        : repoRoot,
    };

    return {
      executable: venvPython,
      moduleArgs: ["-m", "analysis.api", ...cliArgs],
      cwd: repoRoot,
      env,
    };
  }
}
