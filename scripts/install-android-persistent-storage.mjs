import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const androidRoot = path.join(root, 'android');
const pluginSource = path.join(root, 'android-native', 'RmpPersistentStoragePlugin.java');
const pluginDirectory = path.join(androidRoot, 'app/src/main/java/com/recipemaster/app');
const pluginTarget = path.join(pluginDirectory, 'RmpPersistentStoragePlugin.java');
const mainActivity = path.join(pluginDirectory, 'MainActivity.java');
const manifestPath = path.join(androidRoot, 'app/src/main/AndroidManifest.xml');

await Promise.all([pluginSource, mainActivity, manifestPath].map(async file => {
  try { await access(file); } catch { throw new Error('Required generated Android file is missing: ' + file); }
}));

await mkdir(pluginDirectory, { recursive: true });
await cp(pluginSource, pluginTarget);

let activity = await readFile(mainActivity, 'utf8');
if (!activity.includes('import android.os.Bundle;')) {
  activity = activity.replace(/(package [^;]+;\s*)/, '$1\nimport android.os.Bundle;\nimport com.recipemaster.app.RmpPersistentStoragePlugin;\n');
}
if (!activity.includes('RmpPersistentStoragePlugin.class')) {
  const classMatch = activity.match(/(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/);
  if (!classMatch) throw new Error('Unexpected MainActivity structure; refusing to patch blindly.');
  const registration = `
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RmpPersistentStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
`;
  activity = activity.replace(classMatch[1], classMatch[1] + registration);
}
await writeFile(mainActivity, activity, 'utf8');

let manifest = await readFile(manifestPath, 'utf8');
const permissions = [
  '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'
];
for (const permission of permissions) {
  const name = permission.match(/android:name="([^"]+)"/)[1];
  if (!manifest.includes(name)) {
    manifest = manifest.replace(/(<application\b)/, permission + '\n    $1');
  }
}
await writeFile(manifestPath, manifest, 'utf8');
console.log('Installed Recipe Master Plus persistent SQLite/file storage plugin and Android permissions.');
