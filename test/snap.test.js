import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../src/geometry.js';
import {
  IDENTITY, determinant, makeInstance, snapOptions, overlaps, grow, SpatialIndex, faceVertices,
} from '../src/snap.js';

const flush = (a, fa, b) =>
  b.faces.some(
    (f) =>
      f.sides === a.faces[fa].sides &&
      faceVertices(a, fa).every((p) => f.verts.some((i) => distance(b.vertices[i], p) < 1e-6)),
  );

test('snapped solids sit flush on the target face without overlapping', () => {
  const pairs = [
    ['truncatedIcosahedron', 'truncatedIcosahedron'],
    ['octahedron', 'tetrahedron'],
    ['cube', 'rhombicuboctahedron'],
    ['snubCube', 'snubCube'],
    ['truncatedOctahedron', 'cube'],
  ];
  for (const [base, attach] of pairs) {
    const a = makeInstance(base, IDENTITY);
    for (let fi = 0; fi < a.faces.length; fi++) {
      const options = snapOptions(attach, a, fi);
      const hasType = makeInstance(attach, IDENTITY).faces.some((f) => f.sides === a.faces[fi].sides);
      assert.equal(options.length > 0, hasType);
      for (const T of options) {
        const b = makeInstance(attach, T);
        assert.ok(flush(a, fi, b), `${attach} flush on ${base} face ${fi}`);
        assert.ok(Math.abs(Math.abs(determinant(T.R)) - 1) < 1e-9);
      }
    }
  }
});

test('orientation options are deduplicated by symmetry', () => {
  const cube = makeInstance('cube', IDENTITY);
  assert.equal(snapOptions('cube', cube, 0).length, 1);
  const ti = makeInstance('truncatedIcosahedron', IDENTITY);
  const pent = ti.faces.findIndex((f) => f.sides === 5);
  const hex = ti.faces.findIndex((f) => f.sides === 6);
  assert.equal(snapOptions('truncatedIcosahedron', ti, pent).length, 1); // 5-fold axis

  assert.equal(snapOptions('truncatedIcosahedron', ti, hex).length, 2); // 3-fold axis
  // Chiral: mirror images give extra options.
  const snub = makeInstance('snubCube', IDENTITY);
  const sq = snub.faces.findIndex((f) => f.sides === 4);
  assert.equal(snapOptions('snubCube', snub, sq).length, 2);
});

test('mirror-image neighbour is listed first for same-solid snapping', () => {
  const ti = makeInstance('truncatedIcosahedron', IDENTITY);
  for (let fi = 0; fi < ti.faces.length; fi++) {
    const [T] = snapOptions('truncatedIcosahedron', ti, fi);
    const b = makeInstance('truncatedIcosahedron', T);
    const f = ti.faces[fi];
    for (const v of ti.vertices) {
      const d = f.normal[0] * v[0] + f.normal[1] * v[1] + f.normal[2] * v[2] - f.d;
      const mirrored = v.map((c, i) => c - 2 * d * f.normal[i]);
      assert.ok(b.vertices.some((w) => distance(w, mirrored) < 1e-6));
    }
  }
});

test('overlap detection', () => {
  const a = makeInstance('cube', IDENTITY);
  const shift = (t) => makeInstance('cube', { R: IDENTITY.R, t });
  assert.equal(overlaps(a, a), true);
  assert.equal(overlaps(a, shift([1, 0, 0])), false, 'face contact');
  assert.equal(overlaps(a, shift([1, 1, 0])), false, 'edge contact');
  assert.equal(overlaps(a, shift([0.9, 0, 0])), true);
  assert.equal(overlaps(a, shift([0.9, 0.9, 0.9])), true, 'corner overlap');
  assert.equal(overlaps(a, shift([3, 0, 0])), false);
  // Edge-edge crossing where no vertex of either is inside the other.
  const r = Math.SQRT1_2;
  const rotated = makeInstance('cube', { R: [r, -r, 0, r, r, 0, 0, 0, 1], t: [0, 0, 0.95] });
  assert.equal(overlaps(a, rotated), true);
});

function lattice(key, sides, mode, generations) {
  const seed = makeInstance(key, IDENTITY);
  const index = new SpatialIndex();
  index.insert(seed);
  return grow({ seeds: [seed], index, sides: new Set(sides), mode, generations });
}

test('cubes grow into a cubic lattice', () => {
  // Generation counts of the octahedral "ball" in Z^3: 6, 18, 38.
  assert.equal(lattice('cube', [4], 'translate', 1).length, 6);
  assert.equal(lattice('cube', [4], 'mirror', 3).length, 6 + 18 + 38);
});

test('truncated octahedra tile space by translation across all faces', () => {
  const added = lattice('truncatedOctahedron', [4, 6], 'translate', 2);
  assert.equal(added.slice(0, 14).length, 14);
  for (let i = 0; i < added.length; i++)
    for (let j = i + 1; j < added.length; j++) assert.equal(overlaps(added[i], added[j]), false);
});

test('truncated icosahedra skip colliding placements', () => {
  const added = lattice('truncatedIcosahedron', [5, 6], 'mirror', 2);
  for (let i = 0; i < added.length; i++)
    for (let j = i + 1; j < added.length; j++) assert.equal(overlaps(added[i], added[j]), false);
  assert.ok(added.length > 0);
});

test('translate mode skips faces without a matching opposite face', () => {
  assert.equal(lattice('dodecahedron', [5], 'translate', 1).length, 0);
  assert.equal(lattice('tetrahedron', [3], 'translate', 1).length, 0);
});
