import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS, buildSolid, distance } from '../src/geometry.js';
import { regularHull } from '../src/johnson.js';
import { IDENTITY, makeInstance, snapOptions, overlaps, faceVertices } from '../src/snap.js';

const J = (n) => buildSolid(`johnson${n}`);

// Sorted pairwise vertex distances: equal for congruent solids (mirror images
// included), so it tells ortho and gyro forms apart.
function distances(s) {
  const d = [];
  for (let i = 0; i < s.vertices.length; i++)
    for (let j = i + 1; j < s.vertices.length; j++) d.push(distance(s.vertices[i], s.vertices[j]));
  return d.sort((a, b) => a - b);
}
const congruent = (a, b) =>
  a.vertices.length === b.vertices.length && distances(a).every((x, i) => Math.abs(x - distances(b)[i]) < 1e-6);

test('all 92 Johnson solids build as convex solids with unit-edge regular faces', () => {
  const keys = Object.keys(SOLIDS).filter((k) => SOLIDS[k].family === 'Johnson');
  assert.equal(keys.length, 92);
  for (let n = 1; n <= 92; n++) {
    const s = J(n);
    assert.equal(s.label, `J${n}`);
    assert.ok(regularHull(s.vertices), `J${n} ${s.name}`);
    assert.equal(s.vertices.length - s.edges.length + s.faces.length, 2);
  }
});

test('Johnson solids have the published face counts', () => {
  const expected = {
    1: [5, 8, { 3: 4, 4: 1 }],
    26: [8, 14, { 3: 4, 4: 4 }],
    63: [9, 15, { 3: 5, 5: 3 }],
    84: [8, 18, { 3: 12 }],
    91: [14, 26, { 3: 8, 4: 2, 5: 4 }],
    92: [18, 36, { 3: 13, 4: 3, 5: 3, 6: 1 }],
  };
  for (const [n, [V, E, faces]] of Object.entries(expected)) {
    const s = J(n);
    assert.equal(s.vertices.length, V, `J${n} vertices`);
    assert.equal(s.edges.length, E, `J${n} edges`);
    assert.deepEqual(s.faceCounts, faces, `J${n} faces`);
  }
});

test('no two Johnson solids are congruent, and none is an Archimedean solid', () => {
  // The closest calls: each ortho form against its gyro twin, which is
  // sometimes an Archimedean solid.
  const pairs = [
    [J(27), buildSolid('cuboctahedron')],
    [J(34), buildSolid('icosidodecahedron')],
    [J(37), buildSolid('rhombicuboctahedron')],
    [J(28), J(29)], [J(30), J(31)], [J(32), J(33)], [J(35), J(36)],
    [J(38), J(39)], [J(40), J(41)], [J(42), J(43)],
    [J(72), buildSolid('rhombicosidodecahedron')], [J(73), J(74)], [J(80), J(81)],
  ];
  for (const [a, b] of pairs) assert.equal(congruent(a, b), false, `${a.name} vs ${b.name}`);
  for (const [a, b] of pairs) assert.deepEqual(a.faceCounts, b.faceCounts, 'twins share face counts');
});

test('only the gyroelongated bicupolae, cupolarotunda and birotunda are chiral', () => {
  const chiral = Object.values(SOLIDS).filter((s) => s.family === 'Johnson' && s.chiral).map((s) => s.label);
  assert.deepEqual(chiral, ['J44', 'J45', 'J46', 'J47', 'J48']);
});

test('Johnson solids snap onto the other solids', () => {
  const cube = makeInstance('cube', IDENTITY);
  const [T] = snapOptions('johnson1', cube, 0);
  const pyramid = makeInstance('johnson1', T);
  assert.equal(overlaps(cube, pyramid), false);
  // The pyramid's square sits exactly on the cube's face.
  for (const p of faceVertices(cube, 0)) assert.ok(pyramid.vertices.some((v) => distance(v, p) < 1e-9));

  // A rotunda on a decagon of the truncated icosidodecahedron.
  const tid = makeInstance('truncatedIcosidodecahedron', IDENTITY);
  const dec = tid.faces.findIndex((f) => f.sides === 10);
  const options = snapOptions('johnson6', tid, dec);
  assert.ok(options.length > 0);
  assert.ok(options.some((T) => !overlaps(tid, makeInstance('johnson6', T))));
});
