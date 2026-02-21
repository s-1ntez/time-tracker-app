# Windows build

## Option 1: Build on Windows (recommended)

1. Install Node.js 20+ and Rust.
2. Open PowerShell in `time-tracker-app`.
3. Run:

```powershell
npm ci
npm run tauri:build:win
```

Build output:
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`

## Option 2: Build using GitHub Actions

Workflow file:
- `.github/workflows/windows-tauri-build.yml`

How to use:
1. Push project to GitHub.
2. Open `Actions` tab.
3. Run `Build Windows App` workflow (`Run workflow`).
4. Download artifacts:
- `time-tracker-windows-nsis` (`.exe`)
- `time-tracker-windows-msi` (`.msi`)
