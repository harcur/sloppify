// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

// Minimal localStorage stand-in. failAt: the Nth setItem throws once, like hitting the quota.
export class MemoryStorage {
  constructor() { this.map = new Map(); this.writes = 0; this.failAt = 0; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (++this.writes === this.failAt) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}
