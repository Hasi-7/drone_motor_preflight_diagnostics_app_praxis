/**
 * SettingsService — persists app settings to a JSON file in the userData dir.
 */
import fs from "fs";
import path from "path";
import type { AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";

export class SettingsService {
  private readonly filePath: string;
  private cache: AppSettings | null = null;

  constructor(appDataDir: string) {
    this.filePath = path.join(appDataDir, "settings.json");
  }

  get(): AppSettings {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        this.cache = { ...DEFAULT_SETTINGS, ...raw };
        return this.cache!;
      }
    } catch {
      // ignore corrupt file
    }
    return { ...DEFAULT_SETTINGS };
  }

  save(partial: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const updated = { ...current, ...partial };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(updated, null, 2), "utf-8");
    this.cache = updated;
    return updated;
  }
}
