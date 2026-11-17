import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'www');

async function required(source) {
  try {
    await access(path.join(root, source));
  } catch {
    throw new Error(`Required Recipe Master Plus asset is missing: ${source}`);
  }
}

await Promise.all([
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'recipes_library.json',
  'src/backup-image-adapter.js',
  'src/ai-recipe-importer.js',
  'icons/icon-512.svg',
  'icons/odin-wolf.svg'
].map(required));

await mkdir(output, { recursive: true });
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'recipes_library.json']) {
  await cp(path.join(root, file), path.join(output, file));
}
for (const directory of ['src', 'icons']) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}
console.log('Recipe Master Plus Android web bundle prepared in ./www');
