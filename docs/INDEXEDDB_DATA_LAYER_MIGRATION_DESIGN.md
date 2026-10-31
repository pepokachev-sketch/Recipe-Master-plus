# Recipe Master Plus — IndexedDB Data Layer Migration Design

Status: design only; not active in the application.
Target branch: work/nav-sync-v18-3-2026-10-31
Baseline index.html blob SHA: 8e1ff6658522e2a062459f665b14ca48c0c3c320

## 1. Current behavior and compatibility constraints

The application currently hydrates these four state collections synchronously from LocalStorage:

- myrecipes_v1 (only user-owned recipes are serialized; central-library entries are excluded)
- mymeat_v1
- myshop_v1
- myrecipes_customcats_v1

persist() is synchronous and returns a boolean. It serializes all four collections, performs a 3.5 MiB preflight budget check, snapshots previous LocalStorage values, writes each key, and rolls back on failure. It also restores in-memory state from lastCommittedState and updates the UI. storageReadErrors blocks all writes.

There are 23 textual persist() occurrences including the function declaration; 22 call sites. They are not interchangeable: some depend on the boolean synchronously, some need local rollback, and some run during startup migrations or import/restore flows.

## 2. Call-site inventory

| Area | Lines in baseline | Current dependency |
| --- | ---: | --- |
| Image reference migration | 837 | Requires synchronous success/failure; restores original image values and throws on failure |
| Recipe/category startup migration | 891 | Startup write; currently ignores false |
| Add recipe ingredients to shopping | 926 | Aborts render on false |
| Favorite toggle | 1039 | Persists user recipes; central favorites use a separate LocalStorage key |
| Upload recipe photo | 1076 | Async handler; rolls recipe object back on false |
| Select online recipe photo | 1108 | Async flow; aborts UI refresh on false |
| Change recipe category | 1134 | Restores category and rerenders on false |
| Add detail ingredients to shopping | 1185 | Aborts navigation/render on false |
| Save recipe | 1221 | Restores prior recipes array on false |
| Delete recipe | 1222 | Restores prior recipes array on false |
| Save meat note | 1231 | Aborts form reset/render on false |
| Delete meat note | 1233 | Aborts render on false |
| Add shopping item | 1235 | Aborts input reset/render on false |
| Toggle/delete shopping item | 1236 | Aborts render on false |
| Clear completed shopping | 1237 | Aborts render on false |
| Clear shopping list | 1238 | Aborts render on false |
| Restore backup | 1287 | Must not announce success unless durable commit succeeded |
| Merge backup | 1297 | Must not announce success unless durable commit succeeded |
| Save custom categories wrapper | 1358 | Returns persist() result to callers |
| Save/edit custom category | 1368 | Async photo flow; mutates recipes/categories together; currently does not restore all mutations when persist fails |
| Delete custom category | 1369 | Mutates recipes, customCategories and categories together |
| Reorder custom categories | 1370 | Mutates customCategories and categories together |

Note: line numbers are baseline references and will move as the file changes.

## 3. Target database

Use a new database named recipe-master-plus-data with an explicit schema version.

Object stores:
- appState: one record per logical collection, keyed by stable names (recipes, meatNotes, shopping, customCategories, categories if needed).
- images: retain the existing image DB initially or migrate it in a separate verified step. Do not combine image migration with core-state migration in one risky release.
- metadata: schemaVersion, migration status, migration timestamp, record counts, and last successful commit marker.

The existing recipe-master-plus-images database remains authoritative for images until a separately tested consolidation/migration is approved. Avoid moving image blobs and application state in the same first migration.

## 4. Safe migration protocol

1. Open the new database and verify required stores and schema version.
2. Read and parse all four legacy LocalStorage keys without mutating them.
3. Validate every collection as an array; validate record shapes and stable IDs; reject malformed data rather than silently replacing it with empty arrays.
4. In one readwrite IndexedDB transaction, write all four collections and migration metadata including source key names, counts, and a migration marker.
5. Wait for transaction completion (not merely individual request success).
6. Read back all four collections in a fresh readonly transaction and verify counts plus structural validity.
7. Only after successful transaction completion and read-back verification may the app mark IndexedDB as authoritative.
8. Keep legacy LocalStorage snapshots intact for at least one full release cycle and until backup/restore and rollback tests pass.
9. If migration fails, remain in an explicit recovery/blocked state. Do not silently fall back to stale LocalStorage after IndexedDB has become authoritative.

If the IndexedDB transaction aborts, no partial migration may be treated as committed.

## 5. Data Manager contract

Proposed asynchronous interface:

- open(): Promise<Database>
- loadState(): Promise<ValidatedState>
- migrateFromLegacy(storage): Promise<MigrationResult>
- commitState(nextState): Promise<CommitResult>
- readMetadata(): Promise<Metadata>
- verifyState(): Promise<VerificationResult>

commitState must:
- validate the complete state before opening a transaction;
- write all affected collection records in one readwrite transaction;
- resolve only on transaction.oncomplete;
- reject on error/abort;
- serialize commits through a single in-process queue to prevent out-of-order writes;
- never report success before durable transaction completion.

The UI layer should use an explicit readiness gate. No mutation handlers should become active until initial load/migration completes.

## 6. Required application refactor before activation

Do not replace persist() with an async function in isolation.

Refactor every mutation path to:
- capture an immutable pre-mutation snapshot;
- apply or construct the next state;
- await commitState(nextState);
- publish the committed state to the UI only after success, or restore the snapshot on failure;
- handle the failure visibly and consistently.

For asynchronous handlers, guard against duplicate submissions and stale operations. Image upload must not leave an unreferenced image unnoticed; orphan cleanup must be a separate, conservative maintenance operation.

Startup migrations must become awaited initialization steps. Backup restore and merge must not display success before the database transaction commits.

## 7. Rollout stages

A. Add a standalone Data Manager module and unit tests without loading it from index.html.
B. Test transaction completion, abort, quota errors, malformed legacy data, duplicate IDs, concurrent commits, and reload recovery.
C. Refactor mutation paths in groups, preserving rollback semantics.
D. Add a startup readiness gate and one-time migration.
E. Run static syntax checks and automated tests.
F. Test on Android Chrome: fresh install, existing LocalStorage profile, offline reload, photo add/replace, backup/restore, app restart, quota failure.
G. Only then consider merging to main and deploying.

## 8. Known issues to address during refactor

- Startup category/recipe migration at baseline line 891 ignores persist() failure.
- Custom category save/delete/reorder paths do not consistently restore every mutated collection on failure.
- Backup restore and merge must preserve a pre-operation snapshot of all collections.
- Current synchronous render/startup ordering assumes LocalStorage is immediately available.
- The current image DB and new state DB should remain separate in the first rollout.
- LocalStorage fallback after IndexedDB becomes authoritative must be explicit and must never silently load stale state.

## 9. Safety boundary

This document does not activate IndexedDB state storage and does not alter runtime behavior. The current branch's existing LocalStorage persistence remains in place until the complete refactor and test suite are ready. The production main branch is not modified.


## 10. Verified image-reference and backup compatibility findings (2026-10-31)

The current application uses a separate IndexedDB database, `recipe-master-plus-images`, with an `images` object store. Recipe records refer to images through strings such as `idb:img-...`; custom category records use the `photo` field with the same pointer convention. The Data Manager stores these strings as opaque record values and must not copy Blob data into the state database.

The standalone tests now cover:
- migration of recipe and category records containing `idb:` pointers without rewriting those pointers;
- state commits that leave an independently stored Blob record intact in `recipe-master-plus-images`;
- confirmation that the state database contains only `appState` and `metadata`, not an `images` store;
- preservation of legacy data-URL image fields as data URLs during state migration.

These are fake-indexeddb compatibility tests. They do not execute the application's browser-only image functions, FileReader, URL.createObjectURL, or actual user backup/import UI.

### Existing JSON backup behavior observed in index.html

- Export clones recipes and custom categories, resolves each `idb:` pointer through `rmpImageGet()`, and embeds the resulting data URL in the JSON payload.
- Export aborts if any referenced image cannot be read, leaving application state untouched.
- Import validation currently accepts image data URLs through `safeImageUrl`; it does not treat `idb:` pointers as portable backup images.
- Restore currently assigns the imported collections and persists them through the synchronous LocalStorage `persist()` path. Imported image data URLs remain embedded in recipe/category state until the startup image hydration process converts them into separate Blob records.
- The Data Manager is not wired into export or restore. No tested adapter currently coordinates state commits with image Blob writes during a future IndexedDB restore.

### Required work before activation

1. Extract or expose the actual image serialization/deserialization functions behind a testable adapter without duplicating their behavior.
2. Make restore stage and validate every image Blob first, verify all staged image records, then commit state references. On failure, retain the previous state and avoid deleting any pre-existing image records.
3. Define conservative orphan-image cleanup separately; never delete images merely because a state commit or restore failed.
4. Test export of both Blob-backed records and legacy `dataUrl` records, missing/corrupt images, restore rollback, duplicate references, and reload recovery.
5. Run browser tests on Android Chrome, including offline export/import and app restart.

**Activation remains blocked.** The new state Data Manager is still a preparation module and must not be imported by `index.html` until the above lifecycle and browser tests pass.


## 11. Isolated backup image lifecycle adapter (2026-10-31)

Added `src/backup-image-adapter.js` as a preparation module. It is intentionally not imported by `index.html` yet.

The adapter centralizes the backup image transformation rules in testable functions:

- `serializeBackupImages(state, getImageDataUrl)` clones the state, resolves each unique `idb:` reference once, validates the returned image data URL, and preserves legacy data URLs.
- `restoreBackupImages(state, options)` validates portable data URLs, writes each unique image once, reads each staged image back for verification, replaces data URLs with `idb:` references, and invokes the state commit only after every image is verified.
- Incoming `idb:` references are rejected because they are device-local pointers, not portable backup content.
- If image staging or verification fails, state commit is not attempted.
- If state commit fails, staged image records are deliberately retained. The adapter never deletes existing or newly staged records; conservative orphan collection remains a separate future task.

The adapter uses injected image-store and state-commit functions. This allows deterministic unit tests but does not yet prove the browser IndexedDB, Blob, FileReader, or UI integration. The current app's export/import handlers in `index.html` still use their existing implementation and have not yet been switched to this adapter.

### Automated coverage added

- Blob-backed image export references and legacy data URL preservation.
- Export failure for missing/corrupt image data without mutating the input state.
- Restore staging and read-back verification before state commit.
- Deduplication when multiple records use the same image data URL.
- No state commit when an image is missing/corrupt.
- State commit failure leaves prior application state uncommitted and staged images retained.
- Rejection of device-local `idb:` pointers in portable import payloads.
- Restore with no images.

The CI command now runs both the Data Manager and backup image adapter test files. Passing unit tests do not replace Android Chrome browser tests or integration of this adapter into the actual export/restore UI. **Data Manager activation remains blocked.**
