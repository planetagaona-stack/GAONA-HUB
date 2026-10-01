import { readFile, writeFile, mkdir, mkdtemp, open, stat, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const repository = 'planetagaona-stack/GAONA-HUB';
const day = 24 * 60 * 60 * 1000;
const directories = ['bin', 'src', 'scripts', 'assets', 'docs'];
const rootFiles = ['README.md', 'LICENSE', 'CHANGELOG.md', 'THIRD-PARTY-NOTICES.txt', 'package.json'];

export function newerVersion(candidate, current) {
  if (![candidate, current].every(value => /^\d+\.\d+\.\d+$/.test(value))) return false;
  const next = candidate.split('.').map(Number), old = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (next[i] !== old[i]) return next[i] > old[i];
  return false;
}

export function releaseAssets(release, current) {
  const version = release?.tag_name?.replace(/^v/, '');
  if (release?.draft || release?.prerelease || !newerVersion(version, current)) return null;
  const packageName = `gaona-hub-${version}.tgz`;
  const sumsName = `GAONA-HUB-${version}-SHA256SUMS.txt`;
  const asset = name => release.assets?.find(item => item.name === name && item.browser_download_url === `https://github.com/${repository}/releases/download/v${version}/${name}`);
  const archive = asset(packageName), sums = asset(sumsName);
  if (!archive || !sums) throw new Error('La versión publicada no tiene un paquete verificable.');
  return { version, packageName, archive: archive.browser_download_url, sums: sums.browser_download_url };
}

export function verifyArchive(bytes, sums, name) {
  const line = sums.split(/\r?\n/).find(line => line.trim().endsWith(` ${name}`));
  const expected = /^([0-9a-f]{64})\s+\*?([^\s]+)\s*$/i.exec(line || '');
  if (!expected || expected[2] !== name || createHash('sha256').update(bytes).digest('hex') !== expected[1].toLowerCase()) throw new Error('El paquete no coincide con su SHA-256.');
}

export function safeArchiveEntries(names, details) {
  const allowed = name => name === 'package' || name === 'package/' || name.startsWith('package/') && !/[\\:\x00-\x1f\x7f]/.test(name) && !name.split('/').includes('..') && (
    rootFiles.includes(name.slice(8)) || directories.some(dir => name === `package/${dir}` || name.startsWith(`package/${dir}/`))
  );
  const entries = names.trim().split(/\r?\n/);
  if (entries.length > 500 || !entries.every(allowed) || details.trim().split(/\r?\n/).some(line => !/^[-d]/.test(line))) throw new Error('El paquete contiene rutas o enlaces no permitidos.');
}

async function download(url, limit, request) {
  const response = await request(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'GAONA-HUB-updater', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}.`);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Descarga demasiado grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function checkUpdate(current, request = fetch) {
  const response = await request(`https://api.github.com/repos/${repository}/releases/latest`, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'GAONA-HUB-updater', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}.`);
  return releaseAssets(await response.json(), current);
}

export async function installUpdate(root, release, request = fetch) {
  const lockPath = path.join(root, '.gaona-update.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Otra ventana está actualizando GAONA-HUB; vuelve a abrirlo después.');
    throw error;
  }
  let temporary;
  try {
    const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (!newerVersion(release.version, current.version)) return false;
    const bytes = await download(release.archive, 8 * 1024 * 1024, request);
    const sums = (await download(release.sums, 65536, request)).toString('utf8');
    verifyArchive(bytes, sums, release.packageName);
    temporary = await mkdtemp(path.join(os.tmpdir(), 'gaona-hub-update-'));
    const archive = path.join(temporary, 'release.tgz');
    await writeFile(archive, bytes);
    const options = { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true };
    const names = await run('tar', ['-tzf', archive], options);
    const details = await run('tar', ['-tvzf', archive], options);
    safeArchiveEntries(names.stdout, details.stdout);
    await run('tar', ['-xzf', archive, '-C', temporary], options);
    const payload = path.join(temporary, 'package');
    const metadata = JSON.parse(await readFile(path.join(payload, 'package.json'), 'utf8'));
    if (metadata.name !== 'gaona-hub' || metadata.version !== release.version) throw new Error('El paquete no corresponde a la versión publicada.');
    if (metadata.engines?.node !== current.engines?.node) throw new Error('Esta versión cambia requisitos de Node.js; usa el instalador de Windows.');
    for (const [name, version] of Object.entries(metadata.dependencies || {})) {
      if (current.dependencies?.[name] !== version) throw new Error('Esta versión cambia dependencias; actualiza con el instalador de Windows.');
      const actual = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      if (actual.version !== version) throw new Error('Actualiza las dependencias con el instalador de Windows.');
    }
    const items = [...directories, ...rootFiles];
    const backup = path.join(temporary, 'backup');
    await mkdir(backup);
    const existing = [];
    for (const name of items) {
      try { await stat(path.join(root, name)); existing.push(name); await cp(path.join(root, name), path.join(backup, name), { recursive: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try {
      // Only our JS/assets change. Loaded ConPTY DLLs and user profiles stay intact.
      // Write package.json last so its version announces a completed upgrade.
      for (const name of items) await cp(path.join(payload, name), path.join(root, name), { recursive: true, force: true });
    } catch (error) {
      for (const name of existing) await cp(path.join(backup, name), path.join(root, name), { recursive: true, force: true });
      throw error;
    }
    return true;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function automaticUpdate(root, current, { request = fetch, stateDirectory = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Gaona-HUB') } = {}) {
  if (process.env.GAONA_HUB_AUTO_UPDATE === '0' || !root.replaceAll('\\', '/').endsWith('/node_modules/gaona-hub')) return false;
  const stateFile = path.join(stateDirectory, 'update-state.json');
  try {
    let old = {};
    try { old = JSON.parse(await readFile(stateFile, 'utf8')); } catch { /* First launch. */ }
    if (old.version === current && Number.isFinite(old.checkedAt) && Date.now() - old.checkedAt < day) return false;
    const release = await checkUpdate(current, request);
    if (release) {
      console.error(`GAONA-HUB: actualizando ${current} → ${release.version}…`);
      const changed = await installUpdate(root, release, request);
      if (changed) console.error(`GAONA-HUB ${release.version} actualizado.`);
      return changed;
    }
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ version: current, checkedAt: Date.now() }));
  } catch (error) { console.error(`GAONA-HUB: actualización aplazada (${error.message}). Abriendo la versión instalada.`); }
  return false;
}
