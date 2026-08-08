# App icons

Generate icons before bundling:

```bash
# From the project root, with a 1024x1024 PNG source:
npm install -D @tauri-apps/cli
npx tauri icon path/to/app-icon.png
```

This produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and `icon.ico` expected by `tauri.conf.json`.

The repository already includes the production PNG icon used by the tray and bundle.
