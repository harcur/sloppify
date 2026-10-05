// SPDX-FileCopyrightText: 2026 sloppify contributors
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES, KINDS, EFFECTS, EFFECT_ORDER, STYLES, STYLE_ORDER, PALETTES, PRESET_NAMES, MAX_ZONES, MIN_SIDE, normalize, newZone, fitZone, resize, preset, usesFront, encode, decode,
} from '../../tools/stream-overlay/design.js';
import { rng, noise, sdBox, falloff, field } from '../../tools/stream-overlay/field.js';
import { compose, STYLES as DRAW_STYLES, EFFECTS as DRAW_EFFECTS } from '../../tools/stream-overlay/art.js';

const inside = (z, d) => z.x >= 0 && z.y >= 0 && z.x + z.w <= d.w && z.y + z.h <= d.h && z.w >= MIN_SIDE && z.h >= MIN_SIDE;

test('anything normalizes to a valid design', () => {
  for (const raw of [null, 'x', 42, [], {}, { size: 'huge', zones: 'no' }, { zones: [null, 1, { kind: 'nope', x: 'a', w: -5 }] }]) {
    const d = normalize(raw);
    assert.ok(SIZES[d.size]);
    assert.ok(Array.isArray(d.zones));
    for (const z of d.zones) assert.ok(inside(z, d) && KINDS.includes(z.kind));
  }
  const many = normalize({ zones: Array.from({ length: 30 }, () => ({ kind: 'chat' })) });
  assert.equal(many.zones.length, MAX_ZONES);
  assert.deepEqual(many.zones.map((z) => z.id), Array.from({ length: MAX_ZONES }, (_, i) => i + 1));
});

test('zones stay on the canvas and keep a minimum size', () => {
  const d = normalize({});
  assert.deepEqual(fitZone({ x: 1900, y: -50, w: 400, h: 10 }, d), { x: 1520, y: 0, w: 400, h: MIN_SIDE });
  assert.equal(fitZone({ x: 0, y: 0, w: 5000, h: 5000 }, d).w, 1920);
  for (const kind of KINDS) for (const size of Object.keys(SIZES)) assert.ok(inside(newZone(kind, normalize({ size })), normalize({ size })));
});

test('presets fit every canvas size, and resizing scales zones', () => {
  for (const name of PRESET_NAMES) {
    for (const size of Object.keys(SIZES)) {
      const d = preset(name, size, 9);
      assert.equal(d.size, size);
      assert.ok(d.zones.length > 0);
      for (const z of d.zones) assert.ok(inside(z, d), `${name} ${size}`);
    }
  }
  const d = resize(preset('gameplay'), '1280x720');
  const cam = d.zones.find((z) => z.kind === 'camera');
  assert.deepEqual([cam.x, cam.y, cam.w, cam.h], [27, 467, 320, 227]);
  assert.ok(usesFront(d));
  assert.ok(!usesFront(preset('intermission')));
});

test('links round-trip the whole design, and bad links decode to null', () => {
  const d = preset('chatting', '2560x1440', 12345);
  d.zones[1].power = 9;
  assert.deepEqual(decode(encode(d)), d);
  assert.match(encode(d), /^[A-Za-z0-9_-]+$/);
  for (const bad of ['', 'not base64!', btoa('{}'), btoa('[2]'), undefined]) assert.equal(decode(bad), null);
});

test('random numbers and noise repeat for a seed and stay in range', () => {
  const a = rng(7);
  const b = rng(7);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  const n = noise(3);
  const m = noise(3);
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37;
    const y = i * 0.11 - 20;
    assert.equal(n(x, y, 3), m(x, y, 3));
    assert.ok(Math.abs(n(x, y, 3)) <= 1);
  }
});

test('zone distance is negative inside, zero on the edge, positive outside', () => {
  const z = { x: 100, y: 100, w: 200, h: 100, r: 0 };
  assert.equal(sdBox(z, 200, 150), -50);
  assert.equal(sdBox(z, 100, 150), 0);
  assert.equal(sdBox(z, 320, 150), 20);
  assert.equal(sdBox(z, 303, 204), 5);
  assert.ok(sdBox({ ...z, r: 30 }, 101, 101) > 0, 'rounded corners cut the corner');
  assert.equal(falloff(-5, 10), 1);
  assert.equal(falloff(10, 10), 0.5);
});

test('raised zones lift the field and sunken ones lower it', () => {
  const base = { ...normalize({}), zones: [] };
  const flat = field(base).probe(500, 500).h;
  const lift = field(normalize({ zones: [{ kind: 'camera', effect: 'lift', x: 400, y: 400, w: 200, h: 200, power: 10 }] })).probe(500, 500).h;
  const sink = field(normalize({ zones: [{ kind: 'chat', effect: 'sink', x: 400, y: 400, w: 200, h: 200, power: 10 }] })).probe(500, 500).h;
  assert.ok(lift > flat + 1.5);
  assert.ok(sink < flat - 1.5);
  const f = field(normalize({ zones: [{ kind: 'buttons', effect: 'pile', x: 400, y: 400, w: 200, h: 200 }] })).probe(390, 500, true);
  assert.ok(f.fy > 0.5, 'art falls down beside a gravity zone');
});

// compose on a tiny canvas at scale 0.1: 192 × 108 pixels.
function composed(design) {
  const W = 192;
  const H = 108;
  const art = new Uint8ClampedArray(W * H * 4).fill(255);
  const fx = new Uint8ClampedArray(W * H * 4);
  compose(design, 0.1, art, fx, W, H);
  return { at: (x, y, layer = art) => layer[((Math.floor(y / 10) * W) + Math.floor(x / 10)) * 4 + 3], art, fx };
}

test('compose clears the art inside zones and splits the layers', () => {
  const d = normalize({
    reach: 100,
    zones: [
      { kind: 'chat', place: 'over', x: 1400, y: 100, w: 400, h: 800, fuzz: 0 },
      { kind: 'camera', place: 'under', x: 100, y: 600, w: 600, h: 400, fuzz: 20, frame: 40 },
    ],
  });
  const { at, fx } = composed(d);
  assert.equal(at(1600, 500), 0, 'cleared inside a zone whose content sits on top');
  assert.ok(at(1000, 300) > 200, 'art away from the zones');
  assert.equal(at(1000, 300, fx), 0, 'nothing in the front layer outside zones under the art');
  assert.equal(at(1600, 500, fx), 0);
  assert.ok(at(105, 800, fx) > 200, 'the frame covers the edge of content under the art');
  assert.equal(at(400, 800, fx), 0, 'the middle of that content stays clear');
});

test('reach fades the art away from the zones, and fill paints the background', () => {
  const zones = [{ kind: 'info', x: 100, y: 100, w: 200, h: 100, fuzz: 0 }];
  const near = composed(normalize({ reach: 10, zones }));
  assert.ok(near.at(320, 150) > 200);
  assert.equal(near.at(1800, 1000), 0);
  const filled = composed(normalize({ reach: 100, fill: true, zones }));
  const empty = new Uint8ClampedArray(192 * 108 * 4);
  compose(normalize({ reach: 100, fill: true, zones }), 0.1, empty, new Uint8ClampedArray(192 * 108 * 4), 192, 108);
  assert.equal(empty[(100 * 192 + 180) * 4 + 3], 255, 'filled with no art drawn');
  assert.equal(filled.at(200, 150), 0);
});

test('links made before new options were added still mean the same thing', () => {
  // Links store list indexes, so the original entries must keep their places.
  assert.deepEqual(KINDS.slice(0, 7), ['camera', 'chat', 'game', 'alerts', 'info', 'buttons', 'other']);
  assert.deepEqual(EFFECTS.slice(0, 6), ['lift', 'sink', 'orbit', 'splash', 'pile', 'none']);
  assert.deepEqual(STYLES.slice(0, 6), ['sheet', 'flow', 'contour', 'dots', 'none', 'hatch']);
  assert.deepEqual([...EFFECT_ORDER].sort(), [...EFFECTS].sort());
  assert.deepEqual([...STYLE_ORDER].sort(), [...STYLES].sort());
  // [version, size, seed, style, palette, density, reach, fill, zones]: a camera with "sink" in contours.
  const old = btoa(JSON.stringify([1, '1920x1080', 5, 2, 'moss', 5, 40, 0, [[0, 10, 20, 300, 200, 0, 1, 1, 8, 12, 5]]]));
  const d = decode(old);
  assert.equal(d.style, 'contour');
  assert.deepEqual([d.zones[0].kind, d.zones[0].effect, d.zones[0].place], ['camera', 'sink', 'under']);
});

// A stand-in 2D context: records which methods were called and whether any
// coordinate came out as NaN or Infinity.
function recorder() {
  const calls = {};
  const props = {};
  let bad = 0;
  const ctx = new Proxy({}, {
    get: (_, k) => (k in props ? props[k] : (props[k] = (...args) => {
      calls[k] = (calls[k] ?? 0) + 1;
      if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) bad++;
    })),
    set: (_, k, v) => { props[k] = v; return true; },
  });
  return { ctx, calls, bad: () => bad };
}

test('every art style draws with finite coordinates', () => {
  const design = preset('art', '1280x720', 3);
  const F = field(design);
  for (const name of STYLES.filter((n) => n !== 'none')) {
    const { ctx, calls, bad } = recorder();
    DRAW_STYLES[name](ctx, design, F, PALETTES.ember.colors, 0.25);
    assert.ok((calls.stroke ?? 0) + (calls.fill ?? 0) > 0, `${name} drew nothing`);
    assert.equal(bad(), 0, `${name} produced a bad coordinate`);
  }
});

test('every zone effect draws with finite coordinates, at any strength and corner radius', () => {
  for (const name of EFFECTS.filter((n) => n !== 'none')) {
    for (const [power, r] of [[1, 0], [10, 60]]) {
      const design = normalize({ zones: [{ kind: 'other', effect: name, x: 300, y: 300, w: 400, h: 200, power, r }] });
      const F = field(design);
      const { ctx, calls, bad } = recorder();
      DRAW_EFFECTS[name](ctx, F.zones[0], F, PALETTES.kraft.colors, rng(1), 0.5);
      assert.ok((calls.stroke ?? 0) + (calls.fill ?? 0) + (calls.fillRect ?? 0) > 0, `${name} drew nothing`);
      assert.equal(bad(), 0, `${name} produced a bad coordinate`);
    }
  }
});
