# Recipe Master Plus — Android session log
Date: 2026-11-17
Branch: `feature/android-capacitor`
Repository: `pepokachev-sketch/Recipe-Master-plus`

## User's requested outcome
Prepare a testable Android APK using the user's exact supplied 1536×1536 RGB icon image (`8187.png`) and ensure recipes, notes, categories and images are stored locally on the phone, independently of the user's Chrome/Firefox browser profile and without requiring internet for normal local use.

## Confirmed repository state at start of this session
- Branch head observed: `1254aa07e1c0d7b504e26866870764e1084ae916`.
- Android build workflow creates a Capacitor Android project on each CI run, syncs it and builds a **debug** APK.
- Capacitor configuration uses app ID `com.recipemaster.app`, app name `Recipe Master Plus`, webDir `www`, Android scheme `https`.
- Current app stores recipes, notes, shopping data and custom categories in WebView LocalStorage.
- Current app stores image blobs in IndexedDB database `recipe-master-plus-images`.
- The app has a 3.5 MiB safety preflight for LocalStorage text data.
- `src/indexeddb-data-manager.js` is explicitly marked as a preparation module and is NOT wired into the running app. Do not enable it without a tested migration and backup.
- The current APK workflow uses ephemeral debug signing. No permanent Android signing key or GitHub Actions secrets have been configured.

## Storage clarification
Capacitor's WebView LocalStorage and IndexedDB are physically stored on the phone in the app's private application data area; they are not the same profile/storage as Chrome or Firefox. However, they are still browser-engine storage APIs inside the app's WebView, not ordinary user-visible files in a folder such as Pictures.
If the product requirement is actual image files in app-private filesystem storage, integrate and test the Capacitor Filesystem plugin and an image adapter. This has NOT yet been implemented or verified.
The current storage implementation has NOT been changed in this session.

## Safety constraints
- Do not modify `main` or GitHub Pages.
- Work only on `feature/android-capacitor`.
- Do not delete or overwrite existing LocalStorage/IndexedDB data.
- Do not activate the unintegrated data-manager migration without a verified backup, compatibility plan and tests.
- Do not uninstall the currently installed APK until the user has exported and checked a full JSON backup, including photos.
- Do not claim that a new APK is an in-place update: the current debug signing key is ephemeral, so signature compatibility is not guaranteed.
- Never expose or commit a keystore/private signing key.

## Remaining work
1. Preserve this log and verify the working branch head before each write.
2. Integrate the exact supplied icon (do not generate a replacement) into Android launcher resources and verify adaptive/legacy icon rendering.
3. Decide and implement the local-storage target. Minimum safe test build: retain the current app-private WebView LocalStorage + IndexedDB (which is on-device and separate from browser profiles), clearly label this accurately, and test persistence. Stronger filesystem target: use Capacitor Filesystem for image files and migrate images only with a staged, verified, rollback-safe process.
4. Improve/verify data persistence and backup/restore, including recipe photos and category photos.
5. Run unit/smoke tests and Android CI build; inspect build result and artifact before reporting success.
6. Configure a permanent signing key only when a secure setup path is available. GitHub Secrets cannot be written with the currently available GitHub connector actions. Do not imply that signing is configured.
7. Deliver the APK artifact link only after the workflow has actually completed and its artifact is confirmed.

## Current completion status
- Session log: recorded in this file.
- Exact source icon: supplied and inspected; 1536×1536 RGB.
- Icon integration: pending.
- Filesystem-based image storage: pending.
- Existing app-private LocalStorage/IndexedDB storage: confirmed in source, not changed.
- New APK build: not yet run in this session.
