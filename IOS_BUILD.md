# iPhone app (Tauri iOS)

## What is already prepared

- iOS Rust targets are installed locally.
- NPM scripts added:
  - `npm run tauri:ios:init`
  - `npm run tauri:ios:dev`
  - `npm run tauri:ios:build`
- iOS team field exists in `src-tauri/tauri.conf.json`:
  - `bundle.iOS.developmentTeam`

## Required on macOS before first iPhone build

1. Install full Xcode from App Store.
2. Select full Xcode:
   - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
3. Install Xcode command tools and accept license:
   - `xcodebuild -runFirstLaunch`
4. Install CocoaPods:
   - `sudo gem install cocoapods`
5. Install xcodegen:
   - `brew install xcodegen`

## Build and run on iPhone

1. Set your Apple Team ID in `src-tauri/tauri.conf.json`:
   - `"developmentTeam": "YOUR_TEAM_ID"`
2. Run:
   - `npm run tauri:ios:init`
   - `npm run tauri:ios:dev`
3. Open generated Xcode project when prompted and run on your iPhone.
