import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('the actual primary inline application script parses as JavaScript', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'primary inline script must exist');
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: 'index.inline.js' }));
});

test('the backup adapter is precached by the offline service worker', () => {
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(worker, /src\/backup-image-adapter\.js/);
  assert.match(worker, /cache\.addAll\(\[[^\]]*backup-image-adapter\.js/s);
});

test('backup export uses native Android Documents storage and keeps browser download fallback', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /window\.Capacitor\?\.Plugins\?\.Filesystem/);
  assert.doesNotMatch(html, /window\.Capacitor\.registerPlugin\('Filesystem'\)/);
  assert.match(html, /filesystem-plugin-unavailable/);
  assert.match(html, /Filesystem\.mkdir\(\{path:'Recipe Master Plus',directory:'DOCUMENTS',recursive:true\}\)/);
  assert.match(html, /Filesystem\.writeFile\(\{path:filename,data:jsonText,directory:'DOCUMENTS'\}\)/);
  assert.doesNotMatch(html, /writeFile\(\{path:'Recipe Master Plus\//);
  assert.match(html, /recipe-master-plus-recovery-/);
  assert.match(html, /URL\.createObjectURL\(blob\)/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor/filesystem']);
});
