import { open, readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSignals, toSnapshot } from './signals.js';

const run = promisify(execFile);
const CHUNK_SIZE = 256 * 1024;
const MAX_RECORD = 2 * 1024 * 1024;

export class SessionStore {
  constructor(home) {
    this.root = path.join(home, 'sessions');
    this.files = [];
    this.allFiles = [];
    this.refreshed = 0;
    this.cache = new Map();
    this.gitCache = new Map();
    this.indexFile = path.join(home, 'session_index.jsonl');
    this.titleCache = null;
  }

  async list() {
    if (Date.now() - this.refreshed < 10000) return this.files;
    const found = [];
    const walk = async (directory, depth = 0) => {
      if (depth > 5) return;
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (entry.name.endsWith('.jsonl')) {
          try { const info = await stat(file); found.push({ file, modified: info.mtimeMs }); } catch { /* Session moved. */ }
        }
      }
    };
    await walk(this.root);
    this.allFiles = found.sort((a, b) => b.modified - a.modified);
    this.files = this.allFiles.slice(0, 30);
    this.refreshed = Date.now();
    const retained = new Set(this.files.map(item => item.file));
    for (const key of this.cache.keys()) if (!retained.has(key)) this.cache.delete(key);
    return this.files;
  }

  async resolveSession(prefix) {
    await this.list();
    const candidates = this.allFiles.filter(item => {
      const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(item.file)?.[1];
      return id?.startsWith(prefix);
    });
    if (candidates.length !== 1) return null;
    const state = await this.read(candidates[0].file);
    return state.id?.startsWith(prefix) && candidates[0].file.endsWith(`${state.id}.jsonl`) ? state.id : null;
  }

  async read(file) {
    let handle;
    try {
      const info = await stat(file);
      const old = this.cache.get(file);
      if (old?.size === info.size && old?.modified === info.mtimeMs) return old.state;
      handle = await open(file, 'r');
      let state = {}, offset = 0, dropping = false;
      if (old && info.size > old.size) {
        state = old.state;
        offset = old.offset;
        dropping = old.dropping;
      }
      let carry = Buffer.alloc(0), position = offset;
      while (position < info.size) {
        const chunk = Buffer.alloc(Math.min(CHUNK_SIZE, info.size - position));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
        let start = 0, newline;
        while ((newline = data.indexOf(10, start)) >= 0) {
          const line = data.subarray(start, newline);
          if (!dropping && line.length <= MAX_RECORD) state = parseSignals(line.toString('utf8'), state);
          dropping = false;
          start = newline + 1;
        }
        carry = data.subarray(start);
        if (dropping || carry.length > MAX_RECORD) { carry = Buffer.alloc(0); dropping = true; }
      }
      this.cache.set(file, { size: info.size, modified: info.mtimeMs, offset: position - carry.length, dropping, state });
      return state;
    } catch { return {}; }
    finally { await handle?.close(); }
  }

  async git(cwd) {
    if (!cwd) return { branch: null, dirty: false };
    const old = this.gitCache.get(cwd);
    if (old && Date.now() - old.time < 10000) return old.value;
    let value = { branch: null, dirty: false };
    try {
      const options = { cwd, timeout: 2000, maxBuffer: 65536, windowsHide: true };
      const [branch, status] = await Promise.allSettled([
        run('git', ['symbolic-ref', '--short', '-q', 'HEAD'], options),
        run('git', ['status', '--porcelain', '--untracked-files=no'], options),
      ]);
      if (branch.status === 'fulfilled' && status.status === 'fulfilled') value = { branch: branch.value.stdout.trim(), dirty: Boolean(status.value.stdout.trim()) };
    } catch { /* Git unavailable, detached HEAD, or not a repository. */ }
    this.gitCache.set(cwd, { value, time: Date.now() });
    return value;
  }

  async threadName(id) {
    if (!id) return null;
    try {
      const info = await stat(this.indexFile);
      if (info.size > 8 * 1024 * 1024) return null;
      const old = this.titleCache;
      if (old?.id === id && old.size === info.size && old.modified === info.mtimeMs) return old.name;
      let name = null;
      for (const line of (await readFile(this.indexFile, 'utf8')).split(/\r?\n/)) {
        try {
          const entry = JSON.parse(line);
          if (entry?.id === id && typeof entry.thread_name === 'string') name = entry.thread_name.trim() || null;
        } catch { /* Ignore incomplete or malformed index entries. */ }
      }
      this.titleCache = { id, size: info.size, modified: info.mtimeMs, name };
      return name;
    } catch { this.titleCache = null; return null; }
  }

  async snapshot(id, project) {
    const files = [...await this.list()];
    if (id) {
      const pinned = this.allFiles.find(item => item.file.endsWith(`${id}.jsonl`));
      if (pinned && !files.some(item => item.file === pinned.file)) files.push(pinned);
    }
    const sessions = [];
    let selected;
    for (const item of files) {
      const state = await this.read(item.file);
      if (!state.id) continue;
      const snapshot = toSnapshot(state);
      sessions.push({ id: snapshot.id, project: snapshot.project, model: snapshot.model, status: snapshot.status, updatedAt: new Date(item.modified).toISOString() });
      const matchingProject = !project || path.resolve(state.cwd || '').toLowerCase() === path.resolve(project).toLowerCase();
      if ((!id && !selected && matchingProject) || state.id === id) selected = snapshot;
    }
    if (id && !selected) return { error: 'Sesión no disponible', sessions };
    selected ??= toSnapshot({});
    return { ...selected, threadName: await this.threadName(selected.id), git: await this.git(selected.cwd), sessions, connected: Boolean(selected.id) };
  }
}
