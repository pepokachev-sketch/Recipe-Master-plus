# Android persistent storage — V7

## Scope

This work is isolated on `feature/android-hybrid-storage-v7`. The GitHub Pages `main` branch is not changed.

## Storage layout

The Android native bridge uses the fixed public path:

`Documents/Recipe Master Plus/`

- `Database/recipe-master-plus.db` — SQLite database containing recipes, meat notes, shopping items, and custom categories.
- `Images/` — binary image files, named by stable image ID and MIME-derived extension.
- `Backups/recipe-master-plus-recovery.db` — periodic recovery copy of the SQLite database.

No SAF folder picker is used. The app requests Android's all-files access permission and discovers this fixed path itself.

## Lifecycle

1. On Android startup, the app checks access permission.
2. If needed, it opens Android's all-files access settings. After the user returns, it checks permission again.
3. If a valid SQLite state exists, the app loads it before the legacy app script starts.
4. If no SQLite state exists, the app reads the existing LocalStorage state, hydrates/migrates referenced IndexedDB images into binary files, then commits the four collections to SQLite.
5. After migration, SQLite is the active state store. Each successful app save is queued and committed transactionally.
6. Existing LocalStorage and IndexedDB data are not deleted as part of migration.
7. If the database is incomplete or corrupt, the app attempts recovery from the recovery DB. If recovery is not possible, startup stops rather than silently opening an empty recipe book.

## Reinstall behavior

The SQLite database and images are stored outside the app-private sandbox, in shared Documents storage. They are not part of the app's uninstall-managed private data. After reinstall, Android may revoke the all-files permission, so the app may request that permission again. The user does not need to select a directory or enter a path.

The first V7 run must migrate the existing V6 data before V6 is uninstalled. If Android refuses an in-place update because the APK signing certificates differ, export a full app backup from V6 before uninstalling, then import it into V7. Do not uninstall V6 without a verified backup.

## Build

The Android workflow installs `android-native/RmpPersistentStoragePlugin.java` into the generated Capacitor Android project, registers it in `MainActivity`, adds the required manifest permissions, and builds APK version 7.

The native plugin uses Android's built-in `SQLiteDatabase`; no third-party SQLite dependency is required.

## Verification still required

- Successful GitHub Actions build and APK artifact.
- First-run migration with existing V6 LocalStorage and IndexedDB data.
- Recipe/category image read-back from the public Images folder.
- App restart and persistence checks.
- Uninstall/reinstall test with permission re-grant and automatic SQLite/image discovery.
- Recovery test using the recovery database.
- Test on the actual target Android device before treating V7 as production-ready.
