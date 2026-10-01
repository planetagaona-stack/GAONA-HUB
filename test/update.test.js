import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { newerVersion, releaseAssets, verifyArchive, safeArchiveEntries, installUpdate, automaticUpdate } from '../src/update.js';

const run = promisify(execFile);
const assetRelease = version => ({ tag_name: `v${version}`, assets: [`gaona-hub-${version}.tgz`, `GAONA-HUB-${version}-SHA256SUMS.txt`].map(name => ({ name, browser_download_url: `https://github.com/planetagaona-stack/GAONA-HUB/releases/download/v${version}/${name}` })) });

test('updates select only newer stable releases and exact repository assets', () => {
  assert.equal(newerVersion('0.10.0', '0.9.0'), true);
  assert.equal(newerVersion('0.5.0', '0.5.0'), false);
  assert.equal(newerVersion('0.4.0', '0.5.0'), false);
  assert.equal(newerVersion('0.6.0-beta.1', '0.5.0'), false);
  assert.equal(releaseAssets({ ...assetRelease('0.6.0'), prerelease: true }, '0.5.0'), null);
  assert.equal(releaseAssets({ ...assetRelease('0.6.0'), draft: true }, '0.5.0'), null);
  const release = assetRelease('0.6.0');
  assert.equal(releaseAssets(release, '0.5.0').version, '0.6.0');
  release.assets[0].browser_download_url = 'https://example.com/package.tgz';
  assert.throws(() => releaseAssets(release, '0.5.0'), /verificable/);
});

test('downloads require matching checksums and archives reject escapes and links', () => {
  const bytes = Buffer.from('package');
  const hash = createHash('sha256').update(bytes).digest('hex');
  verifyArchive(bytes, `${hash}  gaona-hub-0.6.0.tgz\n`, 'gaona-hub-0.6.0.tgz');
  assert.throws(() => verifyArchive(Buffer.from('changed'), `${hash}  gaona-hub-0.6.0.tgz`, 'gaona-hub-0.6.0.tgz'), /SHA-256/);
  safeArchiveEntries('package/src/main.js\npackage/package.json\n', '-rw main\n-rw metadata\n');
  for (const entry of ['package/../outside', '/absolute', 'package/node_modules/native.dll', 'package/src/../../outside', 'package/src/C:bad', 'package/src\\bad']) assert.throws(() => safeArchiveEntries(entry, '-rw file'), /no permitidos/);
  assert.throws(() => safeArchiveEntries('package/src/link', 'lrwx link'), /no permitidos/);
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gaona-updater-test-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const root = path.join(directory, 'node_modules', 'gaona-hub');
  await mkdir(path.join(root, 'node_modules', 'node-pty'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'gaona-hub', version: '0.5.0', dependencies: { 'node-pty': '1.1.0' } }));
  await writeFile(path.join(root, 'node_modules', 'node-pty', 'package.json'), JSON.stringify({ version: '1.1.0' }));
  await writeFile(path.join(root, 'node_modules', 'node-pty', 'native.dll'), 'NATIVE_STAYS');
  const payload = path.join(directory, 'package');
  await mkdir(payload);
  for (const name of ['bin', 'src', 'scripts', 'assets', 'docs']) {
    await mkdir(path.join(payload, name));
    await writeFile(path.join(payload, name, 'fixture.txt'), 'NEW');
  }
  for (const name of ['README.md', 'LICENSE', 'CHANGELOG.md', 'THIRD-PARTY-NOTICES.txt']) await writeFile(path.join(payload, name), 'NEW');
  await writeFile(path.join(payload, 'package.json'), JSON.stringify({ name: 'gaona-hub', version: '0.6.0', dependencies: { 'node-pty': '1.1.0' } }));
  const archive = path.join(directory, 'fixture.tgz');
  await run('tar', ['-czf', archive, '-C', directory, 'package']);
  const bytes = await readFile(archive);
  const sums = `${createHash('sha256').update(bytes).digest('hex')}  gaona-hub-0.6.0.tgz\n`;
  const release = releaseAssets(assetRelease('0.6.0'), '0.5.0');
  const request = async url => new Response(url.endsWith('.tgz') ? bytes : sums);
  return { root, directory, request, release, bytes };
}

test('a verified update replaces HUD files and preserves native dependencies', async t => {
  const { root, request, release } = await fixture(t);
  assert.equal(await installUpdate(root, release, request), true);
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, '0.6.0');
  assert.equal(await readFile(path.join(root, 'src', 'fixture.txt'), 'utf8'), 'NEW');
  assert.equal(await readFile(path.join(root, 'node_modules', 'node-pty', 'native.dll'), 'utf8'), 'NATIVE_STAYS');
  await assert.rejects(stat(path.join(root, '.gaona-update.lock')), { code: 'ENOENT' });
});

test('corrupt downloads leave the installed version intact and release the lock', async t => {
  const { root, release, bytes } = await fixture(t);
  await assert.rejects(installUpdate(root, release, async url => new Response(url.endsWith('.tgz') ? bytes : `${'0'.repeat(64)}  gaona-hub-0.6.0.tgz`)), /SHA-256/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, '0.5.0');
  await assert.rejects(stat(path.join(root, '.gaona-update.lock')), { code: 'ENOENT' });
});

test('automatic checks are cached daily and development checkouts are excluded', async t => {
  const { root, directory } = await fixture(t);
  let calls = 0;
  const options = { stateDirectory: path.join(directory, 'state'), request: async () => { calls++; return new Response(JSON.stringify(assetRelease('0.5.0'))); } };
  assert.equal(await automaticUpdate(directory, '0.5.0', options), false);
  assert.equal(calls, 0);
  assert.equal(await automaticUpdate(root, '0.5.0', options), false);
  assert.equal(await automaticUpdate(root, '0.5.0', options), false);
  assert.equal(calls, 1);
});
