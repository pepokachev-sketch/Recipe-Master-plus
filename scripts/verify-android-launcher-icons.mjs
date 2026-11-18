import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('android/app/src/main');
const manifestPath = path.join(root, 'AndroidManifest.xml');
const manifest = await readFile(manifestPath, 'utf8');
if (!/android:icon="@mipmap\/ic_launcher"/.test(manifest)) {
  throw new Error('AndroidManifest.xml does not reference @mipmap/ic_launcher');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const files = await walk(path.join(root, 'res'));
const launcherPngs = files.filter(file => /[\\/]mipmap-[^\\/]+[\\/]ic_launcher\.png$/i.test(file));
if (launcherPngs.length < 4) {
  throw new Error(`Expected launcher PNGs in multiple mipmap densities; found ${launcherPngs.length}`);
}
const adaptiveIcon = files.find(file => /[\\/]mipmap-anydpi-v26[\\/]ic_launcher\.xml$/i.test(file));
if (!adaptiveIcon) {
  throw new Error('Android adaptive launcher icon XML was not generated');
}
console.log(`Verified manifest launcher reference, ${launcherPngs.length} density PNGs, and adaptive icon XML.`);
