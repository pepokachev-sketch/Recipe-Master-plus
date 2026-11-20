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
        if (relativePath.startsWith("/") || relativePath.contains("\\") || relativePath.contains(":")) {
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

    private SQLiteDatabase openDatabase() throws IOException {
        File root = ensureRoot();
        File databaseDirectory = new File(root, "Database");
        File file = new File(databaseDirectory, DB_NAME);
        SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
        db.execSQL("CREATE TABLE IF NOT EXISTS app_state (collection TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
        return db;
    }

    @PluginMethod
    public void loadState(PluginCall call) {
        SQLiteDatabase db = null;
        Cursor cursor = null;
        try {
            db = openDatabase();
            JSObject result = new JSObject();
            boolean found = true;
            for (String collection : COLLECTIONS) {
                cursor = db.rawQuery("SELECT payload FROM app_state WHERE collection = ?", new String[]{collection});
                if (!cursor.moveToFirst()) {
                    found = false;
                    cursor.close();
                    cursor = null;
                    break;
                }
                String payload = cursor.getString(0);
                cursor.close();
                cursor = null;
                JSONArray array = new JSONArray(payload);
                result.put(collection, new JSArray(array.toString()));
            }
            result.put("found", found);
            if (found) {
                Cursor meta = db.rawQuery("SELECT value FROM metadata WHERE key = 'revision'", null);
                if (meta.moveToFirst()) result.put("revision", meta.getString(0));
                meta.close();
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("persistent-database-read-failed: " + error.getMessage(), error);
        } finally {
            if (cursor != null) cursor.close();
            if (db != null) db.close();
        }
    }

    @PluginMethod
    public void saveState(PluginCall call) {
        SQLiteDatabase db = null;
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

                long revision = 1;
                Cursor cursor = db.rawQuery("SELECT value FROM metadata WHERE key = 'revision'", null);
                if (cursor.moveToFirst()) {
                    try { revision = Long.parseLong(cursor.getString(0)) + 1; }
                    catch (NumberFormatException ignored) { revision = 1; }
                }
                cursor.close();
                db.execSQL("INSERT OR REPLACE INTO metadata(key, value) VALUES('revision', ?)", new Object[]{String.valueOf(revision)});
                db.execSQL("INSERT OR REPLACE INTO metadata(key, value) VALUES('updatedAt', ?)", new Object[]{String.valueOf(System.currentTimeMillis())});
                db.setTransactionSuccessful();
                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("revision", revision);
                call.resolve(result);
            } finally {
                db.endTransaction();
            }
        } catch (Exception error) {
            call.reject("persistent-database-write-failed: " + error.getMessage(), error);
        } finally {
            if (db != null) db.close();
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
