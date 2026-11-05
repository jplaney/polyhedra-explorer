import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSolid } from '../src/geometry.js';
import '../src/johnson.js';
import '../src/catalan.js';
import { IDENTITY, makeInstance, snapOptions } from '../src/snap.js';
import { partsList, facePolygon } from '../src/parts.js';
import { tileDesign, tileTriangles, toSTL, toZip } from '../src/tiles.js';

const key = (p) => p.map((c) => c.toFixed(5)).join(',');

// A closed, consistently wound surface: every edge is used exactly once in
// each direction.
function assertWatertight(tris) {
  const edges = new Map();
  for (const t of tris)
    for (let i = 0; i < 3; i++) {
      const k = `${key(t[i])}>${key(t[(i + 1) % 3])}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  for (const [k, n] of edges) {
    assert.equal(n, 1, `edge ${k} used ${n} times`);
    const [a, b] = k.split('>');
    assert.equal(edges.get(`${b}>${a}`), 1, `edge ${k} has no partner`);
  }
}

const volume = (tris) =>
  tris.reduce((s, [a, b, c]) => s + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

const regular = (n) => Array.from({ length: n }, (_, k) => {
  const R = 1 / (2 * Math.sin(Math.PI / n));
  return [R * Math.cos((2 * Math.PI * k) / n), R * Math.sin((2 * Math.PI * k) / n)];
});

test('tiles are watertight, with the volume of a ball-swept polygon less the pockets', () => {
  for (const n of [3, 4, 5, 6, 8, 10]) {
    const design = tileDesign(regular(n), { edge: 40, thickness: 7, ballDiameter: 5, clearance: 0.2 });
    const tris = tileTriangles(design, { arcSteps: 12, profileSteps: 16, sphereSteps: 16 });
    assertWatertight(tris);
    // Steiner's formula for a flat polygon swept by a ball of radius r:
    // 2rA + (π/2)r²·perimeter + (4/3)πr³.
    const r = 3.5, L = 40, A = (n * L * L) / (4 * Math.tan(Math.PI / n));
    const pockets = n * (4 / 3) * Math.PI * design.pocket ** 3;
    const expected = 2 * r * A + (Math.PI / 2) * r * r * n * L + (4 / 3) * Math.PI * r ** 3 - pockets;
    assert.ok(Math.abs(volume(tris) / expected - 1) < 0.01, `${n}-gon: ${volume(tris)} vs ${expected}`);
  }
});

test('magnets sit on each edge, centred in the rounding, with a wall around them', () => {
  const design = tileDesign(regular(4), { edge: 40, thickness: 7, ballDiameter: 5, clearance: 0.2, magnetsPerEdge: 2 });
  assert.equal(design.magnets.length, 8);
  for (const m of design.magnets) assert.equal(m[2], 3.5);
  assert.ok(Math.abs(design.wall - 0.8) < 1e-9);
  assert.ok(Math.abs(design.pauseAt - 6.2) < 1e-9);
  // Two per edge sit symmetrically, so any edge meets any edge magnet to magnet.
  const [a, b] = design.magnets;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [p, q] = design.pts;
  assert.ok(Math.hypot(mid[0] - (p[0] + q[0]) / 2, mid[1] - (p[1] + q[1]) / 2) < 1e-9);
});

test('STL and zip files are well formed', () => {
  const tris = tileTriangles(tileDesign(regular(3)));
  const stl = toSTL(tris, 'triangle');
  const view = new DataView(stl.buffer);
  assert.equal(view.getUint32(80, true), tris.length);
  assert.equal(stl.length, 84 + 50 * tris.length);
  const zip = toZip([{ name: 'a.stl', data: stl }, { name: 'b.stl', data: stl }]);
  const z = new DataView(zip.buffer);
  assert.equal(z.getUint32(0, true), 0x04034b50);
  assert.equal(z.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(z.getUint16(zip.length - 22 + 10, true), 2);
});

test('parts list counts a face shared by two solids once', () => {
  const cube = makeInstance('cube', IDENTITY);
  assert.deepEqual(partsList([cube]).types.map((t) => [t.label, t.count]), [['Square', 6]]);
  const [T] = snapOptions('cube', cube, 0);
  const pair = partsList([cube, makeInstance('cube', T)]);
  assert.deepEqual([pair.total, pair.shared], [11, 1]);

  const j92 = makeInstance('johnson92', IDENTITY);
  assert.deepEqual(partsList([j92]).types.map((t) => [t.label, t.count]), [
    ['Triangle', 13], ['Square', 3], ['Pentagon', 3], ['Hexagon', 1],
  ]);
});

test('Catalan faces are their own tile shape', () => {
  const rd = makeInstance('rhombicDodecahedron', IDENTITY);
  const { types } = partsList([rd, makeInstance('cube', [...snapOptions('cube', makeInstance('cube', IDENTITY), 0)][0] ?? IDENTITY)]);
  assert.deepEqual(types.map((t) => t.label), ['Rhombus (rhombic dodecahedron)', 'Square']);
  // The tile polygon is the face itself: a rhombus with equal sides.
  const poly = facePolygon(rd, 0);
  const sides = poly.map((p, i) => Math.hypot(p[0] - poly[(i + 1) % 4][0], p[1] - poly[(i + 1) % 4][1]));
  assert.ok(sides.every((s) => Math.abs(s - sides[0]) < 1e-9));
  assertWatertight(tileTriangles(tileDesign(poly)));
});
