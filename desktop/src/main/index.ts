import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { DatabaseService } from "./services/database";
import { SettingsService } from "./services/settings";
import { SidecarService } from "./services/sidecar";
import { SyncService } from "./services/sync";
import { registerAnalysisHandlers } from "./ipc/analysis";
import { registerBetaflightHandlers } from "./ipc/betaflight";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let db: DatabaseService;
let settings: SettingsService;
let sidecar: SidecarService;
let syncService: SyncService;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: "default",
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

async function initServices(): Promise<void> {
  // Resolve the app data directory
  const appDataDir = isDev
    ? path.join(process.cwd(), "app-data")
    : path.join(app.getPath("userData"), "app-data");

  // Resolve sidecar path (bundled with the installer)
  const sidecarDir = app.isPackaged
    ? path.join(process.resourcesPath, "analysis-sidecar")
    : path.join(process.cwd(), "..", "analysis-sidecar");

  db = new DatabaseService(path.join(appDataDir, "db", "diagnostics.sqlite"));
  await db.initialize();

  settings = new SettingsService(appDataDir);

  sidecar = new SidecarService(sidecarDir, appDataDir);

  syncService = new SyncService(db);

  // Register IPC handlers
  registerAnalysisHandlers(ipcMain, sidecar, db, appDataDir);
  registerBetaflightHandlers(ipcMain);

  // Settings IPC
  ipcMain.handle("settings:get", () => settings.get());
  ipcMain.handle("settings:save", (_e, partial: Parameters<SettingsService["save"]>[0]) =>
    settings.save(partial),
  );

  // Start background sync if enabled
  syncService.startBackgroundSync();
}

app.whenReady().then(async () => {
  await initServices();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  syncService?.stopBackgroundSync();
  sidecar?.shutdown();
  db?.close();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Prevent multiple instances on Windows
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
