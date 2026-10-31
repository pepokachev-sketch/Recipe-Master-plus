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

There are 22 textual persist() occurrences including the function declaration; 21 call sites. They are not interchangeable: some depend on the boolean synchronously, some need local rollback, and some run during startup migrations or import/restore flows.

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
