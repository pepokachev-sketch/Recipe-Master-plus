package com.recipemaster.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(
    name = "RmpPersistentStorage",
    permissions = {
        @Permission(
            alias = "legacyStorage",
            strings = {
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            }
        )
    }
)
public class RmpPersistentStoragePlugin extends Plugin {
    private static final String APP_FOLDER = "Recipe Master Plus";
    private static final String DB_NAME = "recipe-master-plus.db";
    private static final String[] COLLECTIONS = {
        "recipes", "meatNotes", "shopping", "customCategories"
    };

    private File rootDirectory() {
        File documents = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        return new File(documents, APP_FOLDER);
    }

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return getPermissionState("legacyStorage") == PermissionState.GRANTED;
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("granted", hasStorageAccess());
        result.put("rootPath", rootDirectory().getAbsolutePath());
        return result;
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        call.resolve(permissionResult());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (hasStorageAccess()) {
            call.resolve(permissionResult());
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                startActivityForResult(call, intent, "handleStorageSettingsResult");
            } catch (Exception firstError) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    startActivityForResult(call, fallback, "handleStorageSettingsResult");
                } catch (Exception secondError) {
                    call.reject("Unable to open Android all-files access settings", secondError);
                }
            }
        } else {
            requestPermissionForAlias("legacyStorage", call, "handleLegacyPermissionResult");
        }
    }

    @ActivityCallback
    private void handleStorageSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(permissionResult());
    }

    @PermissionCallback
    private void handleLegacyPermissionResult(PluginCall call) {
        if (call == null) return;
        call.resolve(permissionResult());
    }

    private File ensureRoot() throws IOException {
        if (!hasStorageAccess()) throw new SecurityException("storage-permission-required");
        File root = rootDirectory();
        if (!root.exists() && !root.mkdirs()) throw new IOException("cannot-create-app-folder");
        File images = new File(root, "Images");
        File backups = new File(root, "Backups");
        File database = new File(root, "Database");
        if (!images.exists() && !images.mkdirs()) throw new IOException("cannot-create-images-folder");
        if (!backups.exists() && !backups.mkdirs()) throw new IOException("cannot-create-backups-folder");
        if (!database.exists() && !database.mkdirs()) throw new IOException("cannot-create-database-folder");
        return root.getCanonicalFile();
    }

    private File safeFile(String relativePath) throws IOException {
        if (relativePath == null || relativePath.trim().isEmpty()) throw new IllegalArgumentException("path-required");
        if (relativePath.startsWith("/") || relativePath.contains("\\")) {
            throw new IllegalArgumentException("invalid-relative-path");
        }
        File root = ensureRoot();
        File target = new File(root, relativePath).getCanonicalFile();
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!target.getCanonicalPath().startsWith(rootPath)) throw new SecurityException("path-outside-app-folder");
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("cannot-create-parent-folder");
        return target;
    }

    private File databaseFile() throws IOException {
        File root = ensureRoot();
        return new File(new File(root, "Database"), DB_NAME);
    }

    private void copyFileAtomic(File source, File destination) throws IOException {
        File temporary = new File(destination.getParentFile(), destination.getName() + ".tmp");
        try (FileInputStream input = new FileInputStream(source);
             FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
            output.getFD().sync();
        }
        File previous = new File(destination.getParentFile(), destination.getName() + ".bak");
        if (previous.exists() && !previous.delete()) throw new IOException("cannot-clear-backup-staging-file");
        boolean hadDestination = destination.exists();
        if (hadDestination && !destination.renameTo(previous)) throw new IOException("cannot-stage-previous-backup");
        if (!temporary.renameTo(destination)) {
            if (hadDestination) previous.renameTo(destination);
            temporary.delete();
            throw new IOException("backup-atomic-rename-failed");
        }
        if (hadDestination) previous.delete();
    }

    private SQLiteDatabase openDatabase() throws IOException {
        File file = databaseFile();
        SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
        db.execSQL("PRAGMA synchronous=FULL");
        db.execSQL("CREATE TABLE IF NOT EXISTS app_state (collection TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
        return db;
    }

    private JSObject readStateFromDatabase(SQLiteDatabase db) throws Exception {
        JSObject result = new JSObject();
        boolean allFound = true;
        boolean anyFound = false;
        for (String collection : COLLECTIONS) {
            Cursor cursor = db.rawQuery("SELECT payload FROM app_state WHERE collection = ?", new String[]{collection});
            if (!cursor.moveToFirst()) {
                allFound = false;
                cursor.close();
                continue;
            }
            anyFound = true;
            String payload = cursor.getString(0);
            cursor.close();
            JSONArray array = new JSONArray(payload);
            result.put(collection, new JSArray(array.toString()));
        }
        result.put("found", allFound);
        result.put("hasAnyData", anyFound);
        if (allFound) {
            Cursor meta = db.rawQuery("SELECT value FROM metadata WHERE key = 'revision'", null);
            if (meta.moveToFirst()) result.put("revision", meta.getString(0));
            meta.close();
        }
        return result;
    }

    @PluginMethod
    public void loadState(PluginCall call) {
        SQLiteDatabase db = null;
        Exception primaryError = null;
        try {
            db = openDatabase();
            JSObject result = readStateFromDatabase(db);
            db.close();
            db = null;

            if (!Boolean.TRUE.equals(result.getBool("found"))) {
                if (Boolean.TRUE.equals(result.getBool("hasAnyData"))) {
                    throw new IOException("incomplete-primary-database-state");
                }
                File root = ensureRoot();
                File backup = new File(new File(root, "Backups"), "recipe-master-plus-recovery.db");
                if (backup.isFile()) {
                    SQLiteDatabase backupDb = SQLiteDatabase.openDatabase(backup.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
                    JSObject backupState;
                    try { backupState = readStateFromDatabase(backupDb); }
                    finally { backupDb.close(); }
                    if (Boolean.TRUE.equals(backupState.getBool("found"))) {
                        copyFileAtomic(backup, databaseFile());
                        backupState.put("recoveredFromBackup", true);
                        call.resolve(backupState);
                        return;
                    }
                }
            }
            call.resolve(result);
            return;
        } catch (Exception error) {
            primaryError = error;
        } finally {
            if (db != null) db.close();
        }

        try {
            File root = ensureRoot();
            File backup = new File(new File(root, "Backups"), "recipe-master-plus-recovery.db");
            if (!backup.isFile()) throw new IOException("recovery-database-not-found");
            SQLiteDatabase backupDb = SQLiteDatabase.openDatabase(backup.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            JSObject backupState;
            try { backupState = readStateFromDatabase(backupDb); }
            finally { backupDb.close(); }
            if (!Boolean.TRUE.equals(backupState.getBool("found"))) throw new IOException("recovery-database-has-no-state");
            copyFileAtomic(backup, databaseFile());
            backupState.put("recoveredFromBackup", true);
            call.resolve(backupState);
        } catch (Exception backupError) {
            if (primaryError != null) primaryError.addSuppressed(backupError);
            call.reject("persistent-database-read-failed; recovery copy unavailable: " + backupError.getMessage(), primaryError != null ? primaryError : backupError);
        }
    }

    @PluginMethod
    public void saveState(PluginCall call) {
        SQLiteDatabase db = null;
        long revision = 1;
        try {
            String[] payloads = new String[COLLECTIONS.length];
            for (int i = 0; i < COLLECTIONS.length; i++) {
                JSArray value = call.getArray(COLLECTIONS[i]);
                if (value == null) throw new IllegalArgumentException("missing-collection:" + COLLECTIONS[i]);
                JSONArray checked = new JSONArray(value.toString());
                payloads[i] = checked.toString();
            }

            db = openDatabase();
            db.beginTransaction();
            try {
                SQLiteStatement statement = db.compileStatement(
                    "INSERT OR REPLACE INTO app_state(collection, payload) VALUES(?, ?)"
                );
                for (int i = 0; i < COLLECTIONS.length; i++) {
                    statement.clearBindings();
                    statement.bindString(1, COLLECTIONS[i]);
                    statement.bindString(2, payloads[i]);
                    statement.executeInsert();
                }
                statement.close();

                Cursor cursor = db.rawQuery("SELECT value FROM metadata WHERE key = 'revision'", null);
                if (cursor.moveToFirst()) {
                    try { revision = Long.parseLong(cursor.getString(0)) + 1; }
                    catch (NumberFormatException ignored) { revision = 1; }
                }
                cursor.close();
                db.execSQL("INSERT OR REPLACE INTO metadata(key, value) VALUES('revision', ?)", new Object[]{String.valueOf(revision)});
                db.execSQL("INSERT OR REPLACE INTO metadata(key, value) VALUES('updatedAt', ?)", new Object[]{String.valueOf(System.currentTimeMillis())});
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            db.close();
            db = null;

            boolean backupWritten = false;
            // Refresh the recovery copy on the first save and then at most every five minutes.
            try {
                File root = ensureRoot();
                File backupFile = new File(new File(root, "Backups"), "recipe-master-plus-recovery.db");
                long lastBackup = 0;
                SQLiteDatabase checkDb = SQLiteDatabase.openDatabase(databaseFile().getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
                Cursor backupCursor = checkDb.rawQuery("SELECT value FROM metadata WHERE key = 'backupAt'", null);
                if (backupCursor.moveToFirst()) {
                    try { lastBackup = Long.parseLong(backupCursor.getString(0)); }
                    catch (NumberFormatException ignored) { lastBackup = 0; }
                }
                backupCursor.close();
                checkDb.close();
                if (!backupFile.exists() || System.currentTimeMillis() - lastBackup >= 300000L) {
                    copyFileAtomic(databaseFile(), backupFile);
                    SQLiteDatabase markDb = SQLiteDatabase.openDatabase(databaseFile().getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE);
                    markDb.execSQL("INSERT OR REPLACE INTO metadata(key, value) VALUES('backupAt', ?)", new Object[]{String.valueOf(System.currentTimeMillis())});
                    markDb.close();
                    backupWritten = true;
                } else {
                    backupWritten = true;
                }
            } catch (Exception backupError) {
                android.util.Log.w("RmpPersistentStorage", "Recovery database copy could not be refreshed", backupError);
            }

            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("revision", revision);
            result.put("backupWritten", backupWritten);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-database-write-failed: " + error.getMessage(), error);
        } finally {
            if (db != null) db.close();
        }
    }

    @PluginMethod
    public void writeImage(PluginCall call) {
        try {
            String id = call.getString("id");
            String dataUrl = call.getString("dataUrl");
            if (id == null || !id.matches("[A-Za-z0-9._:-]{1,100}")) throw new IllegalArgumentException("invalid-image-id");
            if (dataUrl == null || !dataUrl.matches("(?i)^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$")) {
                throw new IllegalArgumentException("invalid-image-data-url");
            }
            int comma = dataUrl.indexOf(',');
            String header = dataUrl.substring(0, comma);
            String mimeType = header.substring(5, header.indexOf(';')).toLowerCase();
            String extension = imageExtension(mimeType);
            byte[] bytes = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT);
            if (bytes.length == 0) throw new IllegalArgumentException("empty-image");
            File target = safeFile("Images/" + id + "." + extension);
            File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }
            File backup = new File(target.getParentFile(), target.getName() + ".bak");
            if (backup.exists() && !backup.delete()) throw new IOException("cannot-clear-image-backup");
            boolean hadTarget = target.exists();
            if (hadTarget && !target.renameTo(backup)) throw new IOException("cannot-stage-existing-image");
            if (!temporary.renameTo(target)) {
                if (hadTarget) backup.renameTo(target);
                temporary.delete();
                throw new IOException("image-atomic-rename-failed");
            }
            if (hadTarget) backup.delete();
            String[] extensions = {"jpg", "png", "webp", "gif"};
            for (String other : extensions) {
                if (!other.equals(extension)) {
                    File stale = new File(target.getParentFile(), id + "." + other);
                    if (stale.exists()) stale.delete();
                }
            }
            JSObject result = new JSObject();
            result.put("written", true);
            result.put("bytes", bytes.length);
            result.put("mimeType", mimeType);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-image-write-failed: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void readImage(PluginCall call) {
        try {
            String id = call.getString("id");
            if (id == null || !id.matches("[A-Za-z0-9._:-]{1,100}")) throw new IllegalArgumentException("invalid-image-id");
            String[][] types = {
                {"jpg", "image/jpeg"}, {"png", "image/png"}, {"webp", "image/webp"}, {"gif", "image/gif"}
            };
            File file = null;
            String mimeType = null;
            for (String[] type : types) {
                File candidate = safeFile("Images/" + id + "." + type[0]);
                if (candidate.isFile()) { file = candidate; mimeType = type[1]; break; }
            }
            JSObject result = new JSObject();
            if (file == null) {
                result.put("found", false);
                call.resolve(result);
                return;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (FileInputStream input = new FileInputStream(file)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            String encoded = android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP);
            result.put("found", true);
            result.put("dataUrl", "data:" + mimeType + ";base64," + encoded);
            result.put("bytes", file.length());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-image-read-failed: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void readText(PluginCall call) {
        try {
            String path = call.getString("path");
            File file = safeFile(path);
            if (!file.exists() || !file.isFile()) {
                JSObject result = new JSObject();
                result.put("found", false);
                call.resolve(result);
                return;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (FileInputStream input = new FileInputStream(file)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            JSObject result = new JSObject();
            result.put("found", true);
            result.put("content", new String(output.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-file-read-failed: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        try {
            String path = call.getString("path");
            String content = call.getString("content");
            if (content == null) throw new IllegalArgumentException("content-required");
            File target = safeFile(path);
            File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }
            if (target.exists() && !target.delete()) throw new IOException("cannot-replace-existing-file");
            if (!temporary.renameTo(target)) {
                temporary.delete();
                throw new IOException("atomic-file-rename-failed");
            }
            JSObject result = new JSObject();
            result.put("written", true);
            result.put("bytes", bytes.length);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-file-write-failed: " + error.getMessage(), error);
        }
    }
}
