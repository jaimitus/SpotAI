/**
 * App version injected at build time from `src-tauri/tauri.conf.json` — the
 * single source of truth. The fallback keeps unit tests and non-Vite runtimes
 * (vitest without the define) working.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";
