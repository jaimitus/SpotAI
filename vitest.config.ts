import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mirror the __APP_VERSION__ define from vite.config.ts so unit tests that
// import src/lib/version.ts resolve the same single source of truth.
const tauriConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, "src-tauri/tauri.conf.json"), "utf-8"),
) as { version?: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(tauriConfig.version ?? "0.0.0"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
