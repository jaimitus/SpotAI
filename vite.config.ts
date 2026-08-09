import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Vite's filesystem watcher uses chokidar which on Windows tries to
    // attach to every file in the workspace, including compiled Rust
    // artifacts under src-tauri/target/. Cargo holds an exclusive write
    // lock on those .dll files during compilation, which surfaces as
    // EBUSY and kills the dev server. The plugin already includes the
    // obvious ignores below, but the chokidar instance still complains
    // about transitive .dll files. Disabling polling + an explicit,
    // exhaustive ignore list keeps the watcher happy on Windows without
    // breaking HMR in src/.
    watch: {
      usePolling: false,
      ignored: [
        "**/node_modules/**",
        "**/target/**",
        "**/dist/**",
        "**/dist_release/**",
        "**/.git/**",
        "**/*.dll",
        "**/*.pdb",
        "**/*.rlib",
        "**/*.rmeta",
      ],
    },
  },
  // belt-and-braces: when watch fails Vite falls back to a less
  // aggressive scan; telling it explicitly that the source dir is just
  // src/ keeps it from ever looking at src-tauri/.
  optimizeDeps: {
    entries: ["src/main.tsx"],
  },
});
