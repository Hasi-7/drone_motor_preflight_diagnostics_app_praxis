/**
 * IPC handlers for Betaflight serial/MSP communication.
 *
 * The BetaflightController implements a session model:
 *   1. connect() — open serial port
 *   2. snapshotConfig() — read and store current settings
 *   3. applyTestSessionConfig() — apply safe bench-test settings
 *   4. runMotor() — spin one motor at preset throttle for preset duration
 *   5. stopAllMotors() — ensure all motors are off
 *   6. restoreConfig() — restore the pre-test settings
 *   7. disconnect() — close the port
 *
 * The controller ensures restoreConfig is always called before disconnect,
 * even if a run was interrupted. If restoration fails, it surfaces the error
 * and blocks silent exit.
 */
import type { IpcMain, WebContents } from "electron";
import { BetaflightController } from "../services/betaflight";

let controller: BetaflightController | null = null;

export function registerBetaflightHandlers(ipcMain: IpcMain): void {

  ipcMain.handle("betaflight:list-ports", async () => {
    return BetaflightController.listPorts();
  });

  ipcMain.handle("betaflight:connect", async (event, args: { portPath: string; baudRate?: number }) => {
    try {
      controller = new BetaflightController(event.sender);
      await controller.connect(args.portPath, args.baudRate ?? 115200);
      const version = await controller.getFirmwareVersion();
      return { connected: true, firmwareVersion: version };
    } catch (err) {
      controller = null;
      return { connected: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("betaflight:disconnect", async () => {
    if (!controller) return;
    try {
      await controller.ensureMotorsStopped();
    } finally {
      await controller.disconnect();
      controller = null;
    }
  });

  ipcMain.handle("betaflight:snapshot-config", async () => {
    if (!controller) return { success: false, error: "Not connected" };
    try {
      const snapshot = await controller.snapshotConfig();
      return { success: true, snapshot };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("betaflight:restore-config", async () => {
    if (!controller) return { success: false, error: "Not connected" };
    try {
      await controller.restoreConfig();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("betaflight:apply-test-config", async () => {
    if (!controller) return { success: false, error: "Not connected" };
    try {
      await controller.applyTestSessionConfig();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("betaflight:run-motor", async (event, args: {
    motorIndex: number;
    throttleValue: number;
    durationMs: number;
  }) => {
    if (!controller) return { success: false, error: "Not connected" };

    // Safety: never accept throttle > 2000
    if (args.throttleValue > 2000 || args.throttleValue < 1000) {
      return { success: false, error: `Invalid throttle value: ${args.throttleValue}` };
    }

    try {
      await controller.runMotor(args.motorIndex, args.throttleValue, args.durationMs);
      return { success: true };
    } catch (err) {
      // Always attempt emergency stop on error
      await controller.ensureMotorsStopped().catch(() => {});
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("betaflight:stop-all-motors", async () => {
    if (!controller) return { success: false, error: "Not connected" };
    try {
      await controller.ensureMotorsStopped();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
