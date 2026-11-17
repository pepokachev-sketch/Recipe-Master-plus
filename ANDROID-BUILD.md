# Recipe Master Plus – Android build (experimental)

This branch adds an isolated Capacitor Android build path. It does not change the GitHub Pages deployment or the `main` branch.

## Current approach

- Capacitor 8.6.2, pinned to the same stable release for core, CLI and Android.
- App ID: `com.recipemaster.app`.
- The web application is copied into `www/` before Capacitor sync.
- The Android project is generated in CI with `npx cap add android`; generated native files are not committed yet.
- GitHub Actions runs the existing data/backup tests before building a debug APK.
- The APK is uploaded as the `recipe-master-plus-debug-apk` workflow artifact.

## Build

Run the **Android APK** workflow manually from the Actions tab, or push a change to this branch that touches one of the configured app paths.

## Important data warning

Capacitor's WebView has its own origin and storage partition. Browser LocalStorage and IndexedDB data do not automatically appear in the Android app. Do not clear browser data and do not activate the dormant data migration module as part of this setup. Before everyday use, test JSON backup/restore on a disposable Android install, including recipes with images and category images.

## Current limitations

This is an initial debug-build pipeline, not a release-ready Android distribution. App icon/splash asset generation, Android permission review, signed release APK/AAB, device testing, and any native file-sharing integration remain follow-up tasks.
