import type { AppApi } from "../shared/preload-api";

declare global {
  interface Window {
    api: AppApi;
  }
}

export {};
