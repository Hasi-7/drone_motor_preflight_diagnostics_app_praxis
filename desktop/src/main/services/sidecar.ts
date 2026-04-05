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
import { ChildProcess, spawn } from "child_process";
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
    const { executable, moduleArgs } = this.resolveSidecarCommand(args);

    return new Promise((resolve, reject) => {
      const proc = spawn(executable, moduleArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: this.sidecarDir,
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
   * In development, we fall back to calling `python -m analysis.api` from
   * the repo root so the developer does not need a separate build step.
   */
  private resolveSidecarCommand(cliArgs: string[]): { executable: string; moduleArgs: string[] } {
    // Packaged: check for compiled exe
    const exePath = path.join(this.sidecarDir, "analysis_sidecar.exe");
    if (fs.existsSync(exePath)) {
      return { executable: exePath, moduleArgs: cliArgs };
    }

    // Development fallback: python -m analysis.api from repo root
    return {
      executable: "python",
      moduleArgs: ["-m", "analysis.api", ...cliArgs],
    };
  }
}
