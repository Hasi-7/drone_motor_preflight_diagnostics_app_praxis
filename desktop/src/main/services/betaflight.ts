/**
 * BetaflightController — serial/MSP communication with stock Betaflight firmware.
 *
 * MSP (MultiWii Serial Protocol) is the native API for Betaflight. This
 * implementation uses the minimum set of MSP commands needed for motor testing:
 *
 *   MSP_IDENT         (100) — firmware version
 *   MSP_SET_MOTOR     (214) — set all 4 motor throttle values
 *   MSP_MOTOR         (104) — read current motor values
 *   MSP_EEPROM_WRITE  (250) — persist config (NOT called in test sessions)
 *   MSP_FEATURE       (36)  — read feature flags
 *   MSP_SET_FEATURE   (37)  — set feature flags (used to enable/disable 3D etc.)
 *   MSP_ARMING_CONFIG (61)  — read arming configuration
 *
 * Session safety model:
 *   - snapshotConfig() reads the relevant config before any changes
 *   - applyTestSessionConfig() enables what is needed for bench testing
 *   - restoreConfig() puts it back exactly as found
 *   - EEPROM is NOT written unless operator explicitly triggers a save
 *   - all motor commands are bounded by a hard timeout
 */
import { SerialPort } from "serialport";
import type { WebContents } from "electron";

// MSP v1 command codes
const MSP_IDENT = 100;
const MSP_MOTOR = 104;
const MSP_SET_MOTOR = 214;
const MSP_FEATURE = 36;
const MSP_SET_FEATURE = 37;

// Preamble bytes for MSP v1 framing
const PREAMBLE_1 = 0x24; // '$'
const PREAMBLE_2 = 0x4d; // 'M'
const DIR_TO_FC = 0x3c;  // '<'

// Motor count (fixed at 4 for quad)
const MOTOR_COUNT = 4;

// Hard maximum motor on-time in ms (safety cap)
const MAX_MOTOR_DURATION_MS = 10_000;

interface ConfigSnapshot {
  featureFlags: number;
}

export class BetaflightController {
  private port: SerialPort | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private responseCallbacks = new Map<number, (payload: Buffer) => void>();
  private snapshot: ConfigSnapshot | null = null;
  private readonly sender: WebContents;

  constructor(sender: WebContents) {
    this.sender = sender;
  }

  // ── Port discovery ──────────────────────────────────────────────────────

  static async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    const ports = await SerialPort.list();
    return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer }));
  }

  // ── Connection ──────────────────────────────────────────────────────────

  async connect(portPath: string, baudRate = 115200): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path: portPath, baudRate }, (err) => {
        if (err) reject(err);
        else resolve();
      });

      this.port.on("data", (chunk: Buffer) => this.onData(chunk));
      this.port.on("error", (err) => console.error("Serial error:", err));
    });
  }

  async disconnect(): Promise<void> {
    if (!this.port?.isOpen) return;
    return new Promise((resolve) => {
      this.port!.close(() => {
        this.port = null;
        resolve();
      });
    });
  }

  // ── Firmware version ────────────────────────────────────────────────────

  async getFirmwareVersion(): Promise<string> {
    const payload = await this.sendCommand(MSP_IDENT, Buffer.alloc(0));
    if (payload.length < 4) return "unknown";
    const version = payload[0];
    return `Betaflight ${version}`;
  }

  // ── Config snapshot / restore ───────────────────────────────────────────

  async snapshotConfig(): Promise<ConfigSnapshot> {
    const payload = await this.sendCommand(MSP_FEATURE, Buffer.alloc(0));
    const featureFlags = payload.readUInt32LE(0);
    this.snapshot = { featureFlags };
    return this.snapshot;
  }

  async applyTestSessionConfig(): Promise<void> {
    if (!this.snapshot) throw new Error("Must call snapshotConfig before applyTestSessionConfig");
    // For bench testing, no special feature changes are needed on stock Betaflight.
    // Motors can be driven via MSP_SET_MOTOR when the FC is not armed.
    // Future: disable 3D mode, set safe motor_output_limit, etc.
  }

  async restoreConfig(): Promise<void> {
    if (!this.snapshot) {
      // Nothing to restore — no snapshot was taken
      return;
    }

    // Restore feature flags (if we modified them)
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(this.snapshot.featureFlags, 0);
    await this.sendCommand(MSP_SET_FEATURE, buf);

    this.snapshot = null;
  }

  // ── Motor control ───────────────────────────────────────────────────────

  async runMotor(
    motorIndex: number,
    throttleValue: number,
    durationMs: number,
  ): Promise<void> {
    if (motorIndex < 0 || motorIndex >= MOTOR_COUNT) {
      throw new Error(`Invalid motor index: ${motorIndex}. Must be 0–${MOTOR_COUNT - 1}.`);
    }
    const safeDuration = Math.min(durationMs, MAX_MOTOR_DURATION_MS);
    const throttles = Array(MOTOR_COUNT).fill(1000);
    throttles[motorIndex] = throttleValue;

    this.emitProgress(motorIndex, "spinning", `Motor ${motorIndex + 1} at ${throttleValue} throttle`);
    await this.setMotors(throttles);

    await this.delay(safeDuration);

    await this.ensureMotorsStopped();
    this.emitProgress(motorIndex, "stopped", `Motor ${motorIndex + 1} stopped`);
  }

  async ensureMotorsStopped(): Promise<void> {
    const throttles = Array(MOTOR_COUNT).fill(1000);
    await this.setMotors(throttles);
  }

  // ── Low-level helpers ───────────────────────────────────────────────────

  private async setMotors(throttles: number[]): Promise<void> {
    // MSP_SET_MOTOR payload: 8 x uint16 LE (up to 8 motors, pad unused with 0)
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      buf.writeUInt16LE(throttles[i] ?? 0, i * 2);
    }
    await this.sendCommand(MSP_SET_MOTOR, buf);
  }

  private sendCommand(command: number, payload: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) {
        reject(new Error("Serial port not open"));
        return;
      }

      // Register callback before sending to avoid race condition
      this.responseCallbacks.set(command, (responsePayload) => {
        this.responseCallbacks.delete(command);
        resolve(responsePayload);
      });

      const frame = this.buildMspFrame(command, payload);
      this.port.write(frame, (err) => {
        if (err) {
          this.responseCallbacks.delete(command);
          reject(err);
        }
      });

      // Timeout safety
      setTimeout(() => {
        if (this.responseCallbacks.has(command)) {
          this.responseCallbacks.delete(command);
          reject(new Error(`MSP command ${command} timed out`));
        }
      }, 2000);
    });
  }

  private buildMspFrame(command: number, payload: Buffer): Buffer {
    // MSP v1: $ M < size cmd payload checksum
    const size = payload.length;
    const frame = Buffer.alloc(6 + size);
    frame[0] = PREAMBLE_1;
    frame[1] = PREAMBLE_2;
    frame[2] = DIR_TO_FC;
    frame[3] = size;
    frame[4] = command;
    payload.copy(frame, 5);

    let checksum = size ^ command;
    for (const byte of payload) checksum ^= byte;
    frame[5 + size] = checksum;

    return frame;
  }

  private onData(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    this.parseResponses();
  }

  private parseResponses(): void {
    while (this.receiveBuffer.length >= 6) {
      // Find $ M > preamble
      const start = this.receiveBuffer.indexOf(Buffer.from([0x24, 0x4d, 0x3e]));
      if (start === -1) {
        this.receiveBuffer = Buffer.alloc(0);
        break;
      }
      if (start > 0) {
        this.receiveBuffer = this.receiveBuffer.subarray(start);
      }

      if (this.receiveBuffer.length < 6) break;

      const size = this.receiveBuffer[3];
      const command = this.receiveBuffer[4];
      const totalLen = 6 + size;

      if (this.receiveBuffer.length < totalLen) break;

      const payload = this.receiveBuffer.subarray(5, 5 + size);

      // Verify checksum
      let checksum = size ^ command;
      for (const byte of payload) checksum ^= byte;
      const receivedChecksum = this.receiveBuffer[5 + size];

      this.receiveBuffer = this.receiveBuffer.subarray(totalLen);

      if (checksum !== receivedChecksum) continue; // discard corrupt frame

      const cb = this.responseCallbacks.get(command);
      if (cb) cb(payload);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private emitProgress(motorIndex: number, stage: string, message: string): void {
    try {
      this.sender.send("motor:run-progress", { motorIndex, stage, message });
    } catch {
      // renderer may have been closed
    }
  }
}
