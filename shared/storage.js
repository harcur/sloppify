// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// All storage goes through here. Keys look like "sloppify:<tool-id>:<key>".
// Only keys with the "sloppify:" prefix are ever read, exported, imported or
// cleared, because every GitHub Pages project on an account shares one origin.
// No DOM access in this file, so it runs under Node for tests.

export const PREFIX = 'sloppify:';
export const BACKUP_FORMAT = 'sloppify-backup';
export const BACKUP_FORMAT_VERSION = 1;
const SCHEMA = '__schema';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

let frozen = false;
let backend = (() => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
})();

export function setBackend(b) { backend = b; }

export function storageAvailable() {
  if (!backend) return false;
  try {
    const k = PREFIX + '__probe';
    backend.setItem(k, '1');
    backend.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function ownKeys() {
  const out = [];
  if (!backend) return out;
  try {
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k !== null && k.startsWith(PREFIX)) out.push(k);
    }
  } catch { /* blocked */ }
  return out;
}

function read(k) {
  try {
    const raw = backend?.getItem(k);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(k, v) {
  if (frozen) throw new Error('Storage frozen');
  backend.setItem(k, JSON.stringify(v)); // throws when full or blocked
}

// Blocks all further writes until the page reloads. Called after a reset or
// import, right before reloading, so a tool saving on pagehide can't put
// back the data that was just cleared.
export function freeze() { frozen = true; }

function remove(k) {
  try { backend?.removeItem(k); } catch { /* blocked */ }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Open a tool's namespaced store.
 * version: the data schema version this code understands.
 * migrate(data, fromVersion, toVersion): returns upgraded data, or throws.
 * After opening, store.status is 'ok' or 'incompatible' (data can't be read
 * by this version; the page should offer export and a reset of this tool).
 * Migration runs when the tool's own page loads, so the hub never needs to
 * load tool code.
 */
export function openStore(id, { version = 1, migrate = null } = {}) {
  if (!ID_RE.test(id)) throw new Error(`Invalid store id: ${id}`);
  const base = PREFIX + id + ':';
  const dataKeys = () => ownKeys().filter((k) => k.startsWith(base) && k !== base + SCHEMA);

  const store = {
    id,
    version,
    status: 'ok',
    get(key, fallback = null) {
      const v = read(base + key);
      return v === undefined ? fallback : v;
    },
    set(key, value) {
      try { write(base + key, value); return true; } catch { return false; }
    },
    remove(key) { remove(base + key); },
    keys() { return dataKeys().map((k) => k.slice(base.length)); },
    getAll() {
      const o = {};
      for (const k of dataKeys()) {
        const v = read(k);
        if (v !== undefined) o[k.slice(base.length)] = v;
      }
      return o;
    },
    clear() {
      for (const k of ownKeys()) if (k.startsWith(base)) remove(k);
      try { write(base + SCHEMA, version); } catch { /* blocked */ }
      store.status = 'ok';
    },
  };

  if (!backend) return store;
  const stored = read(base + SCHEMA);
  if (stored === undefined) {
    try { write(base + SCHEMA, version); } catch { /* blocked */ }
  } else if (!Number.isInteger(stored) || stored > version) {
    store.status = 'incompatible';
  } else if (stored < version) {
    const before = store.getAll();
    try {
      if (!migrate) throw new Error('No migration');
      const after = migrate(structuredClone(before), stored, version);
      if (!isPlain(after)) throw new Error('Migration returned no data');
      for (const k of dataKeys()) remove(k);
      for (const [k, v] of Object.entries(after)) write(base + k, v);
      write(base + SCHEMA, version);
    } catch {
      for (const k of dataKeys()) remove(k);
      for (const [k, v] of Object.entries(before)) { try { write(base + k, v); } catch { /* full */ } }
      store.status = 'incompatible';
    }
  }
  return store;
}

export function exportAll(now = new Date()) {
  const tools = {};
  for (const k of ownKeys()) {
    const rest = k.slice(PREFIX.length);
    const i = rest.indexOf(':');
    if (i < 1) continue;
    const id = rest.slice(0, i);
    const key = rest.slice(i + 1);
    if (!ID_RE.test(id) || !key) continue;
    const v = read(k);
    if (v === undefined) continue;
    const entry = (tools[id] ??= { schemaVersion: 1, data: {} });
    if (key === SCHEMA) { if (Number.isInteger(v) && v >= 1) entry.schemaVersion = v; }
    else entry.data[key] = v;
  }
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: now.toISOString(), tools };
}

export function validateBackup(b) {
  const fail = (error) => ({ ok: false, error });
  if (!isPlain(b)) return fail('not-object');
  if (b.format !== BACKUP_FORMAT) return fail('format');
  if (!Number.isInteger(b.formatVersion) || b.formatVersion < 1) return fail('format-version');
  if (b.formatVersion > BACKUP_FORMAT_VERSION) return fail('newer-format');
  if (!isPlain(b.tools)) return fail('tools');
  for (const [id, e] of Object.entries(b.tools)) {
    if (!ID_RE.test(id)) return fail('tool-id');
    if (!isPlain(e) || !Number.isInteger(e.schemaVersion) || e.schemaVersion < 1 || !isPlain(e.data)) return fail('tool-entry');
    for (const k of Object.keys(e.data)) if (!k || k === SCHEMA) return fail('key');
  }
  return { ok: true };
}

export function resetAll() {
  for (const k of ownKeys()) remove(k);
}

// Clears one tool's data, schema version included. Other tools and the hub
// (favourites, recents, theme) are left alone.
export function resetTool(id) {
  if (!ID_RE.test(id)) throw new Error(`Invalid store id: ${id}`);
  const base = PREFIX + id + ':';
  for (const k of ownKeys()) if (k.startsWith(base)) remove(k);
}

// Replaces everything. On failure, restores the previous data and rethrows.
export function importAll(b) {
  const check = validateBackup(b);
  if (!check.ok) throw new Error(`Invalid backup: ${check.error}`);
  const snapshot = ownKeys().map((k) => [k, backend.getItem(k)]);
  try {
    resetAll();
    for (const [id, e] of Object.entries(b.tools)) {
      write(PREFIX + id + ':' + SCHEMA, e.schemaVersion);
      for (const [k, v] of Object.entries(e.data)) write(PREFIX + id + ':' + k, v);
    }
  } catch (err) {
    resetAll();
    for (const [k, raw] of snapshot) { try { backend.setItem(k, raw); } catch { /* full */ } }
    throw err;
  }
}
