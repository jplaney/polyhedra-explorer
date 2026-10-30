import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS } from '../src/geometry.js';
import '../src/johnson.js';
import { IDENTITY, makeInstance, overlaps } from '../src/snap.js';
import { edgeFan, dihedralAt, dihedralAngles, angleLibrary, exactFills, gapPlacements, toDegrees } from '../src/edges.js';

const near = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) < tol, `${actual} ≉ ${expected}`);
const firstEdge = (inst) => inst.solid.edges[0].map((i) => inst.vertices[i]);

// Add each of `keys` in turn into the largest gap around the first solid's first edge.
function fanOf(keys) {
  const seed = makeInstance(keys[0], IDENTITY);
  const [a, b] = firstEdge(seed);
  const placed = [seed];
  for (const key of keys.slice(1)) {
    const fan = edgeFan(placed, a, b);
    const gap = fan.gaps.reduce((x, y) => (y.size > x.size ? y : x));
    const [option] = gapPlacements(key, gap, fan.frame);
    placed.push(option.cand);
  }
  return { placed, fan: edgeFan(placed, a, b) };
}
const gapDegrees = (fan) => toDegrees(fan.gaps.reduce((s, g) => s + g.size, 0));

test('dihedral angles of familiar solids', () => {
  const at = (key) => {
    const inst = makeInstance(key, IDENTITY);
    return toDegrees(dihedralAt(inst, ...firstEdge(inst)));
  };
  near(at('cube'), 90);
  near(at('tetrahedron'), 70.5288);
  near(at('octahedron'), 109.4712);
  near(at('dodecahedron'), 116.5651);
  near(at('icosahedron'), 138.1897);
  assert.deepEqual(dihedralAngles('truncatedOctahedron').map((d) => [toDegrees(d.angle).toFixed(2), d.between]), [
    ['109.47', 'hexagon–hexagon'],
    ['125.26', 'square–hexagon'],
  ]);
});

test('five tetrahedra around an edge leave a 7.36° gap', () => {
  const { placed, fan } = fanOf(Array(5).fill('tetrahedron'));
  assert.equal(fan.wedges.length, 5);
  near(gapDegrees(fan), 7.356);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) assert.equal(overlaps(placed[i], placed[j]), false);
});

test('three dodecahedra leave 10.3°; four cubes close exactly', () => {
  near(gapDegrees(fanOf(Array(3).fill('dodecahedron')).fan), 10.305);
  const cubes = fanOf(Array(4).fill('cube')).fan;
  assert.equal(cubes.wedges.length, 4);
  assert.ok(cubes.gaps.every((g) => g.size === 0));
});

test('tetrahedra and octahedra alternate to close an edge', () => {
  const { fan } = fanOf(['tetrahedron', 'octahedron', 'tetrahedron', 'octahedron']);
  near(toDegrees(fan.filled), 360);
  assert.ok(fan.gaps.every((g) => g.size === 0));
});

test('an extra solid that does not fit shows up as an overlap', () => {
  const { fan } = fanOf(Array(4).fill('icosahedron').slice(0, 3)); // 3 × 138.19° > 360°
  assert.ok(fan.gaps.some((g) => g.size < 0));
});

test('exact fills by angle', () => {
  const library = angleLibrary(['tetrahedron', 'cube', 'octahedron', 'truncatedOctahedron']);
  const describe = (combo) => combo.map((e) => toDegrees(e.angle).toFixed(2)).join(' + ');
  // What closes the edge left by one tetrahedron and one octahedron?
  const fills = exactFills((2 * Math.PI) - dihedralAt(makeInstance('tetrahedron', IDENTITY), ...firstEdge(makeInstance('tetrahedron', IDENTITY))) - (109.4712 * Math.PI) / 180, library);
  assert.ok(fills.some((c) => describe(c) === '70.53 + 109.47'));
  assert.equal(describe(exactFills(Math.PI / 2, library)[0]), '90.00');
  assert.deepEqual(exactFills(0, library), []);
});

test('the angle library covers every solid', () => {
  const keys = Object.keys(SOLIDS);
  const library = angleLibrary(keys);
  assert.ok(keys.every((k) => library.some((e) => e.keys.includes(k))));
  // 90° appears in the cube, the prisms and many Johnson solids.
  assert.ok(library.find((e) => Math.abs(toDegrees(e.angle) - 90) < 1e-6).keys.length > 10);
});
