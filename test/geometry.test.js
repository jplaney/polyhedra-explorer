import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS, buildSolid, distance, length, dot, sub } from '../src/geometry.js';

// [vertices, edges, faces by side count, circumradius for unit edge]
const EXPECTED = {
  tetrahedron: [4, 6, { 3: 4 }, 0.6124],
  cube: [8, 12, { 4: 6 }, 0.866],
  octahedron: [6, 12, { 3: 8 }, 0.7071],
  dodecahedron: [20, 30, { 5: 12 }, 1.4013],
  icosahedron: [12, 30, { 3: 20 }, 0.9511],
  truncatedTetrahedron: [12, 18, { 3: 4, 6: 4 }, 1.1726],
  cuboctahedron: [12, 24, { 3: 8, 4: 6 }, 1],
  truncatedCube: [24, 36, { 3: 8, 8: 6 }, 1.7788],
  truncatedOctahedron: [24, 36, { 4: 6, 6: 8 }, 1.5811],
  rhombicuboctahedron: [24, 48, { 3: 8, 4: 18 }, 1.399],
  truncatedCuboctahedron: [48, 72, { 4: 12, 6: 8, 8: 6 }, 2.3176],
  snubCube: [24, 60, { 3: 32, 4: 6 }, 1.3437],
  icosidodecahedron: [30, 60, { 3: 20, 5: 12 }, 1.618],
  truncatedDodecahedron: [60, 90, { 3: 20, 10: 12 }, 2.9694],
  truncatedIcosahedron: [60, 90, { 5: 12, 6: 20 }, 2.478],
  rhombicosidodecahedron: [60, 120, { 3: 20, 4: 30, 5: 12 }, 2.233],
  truncatedIcosidodecahedron: [120, 180, { 4: 30, 6: 20, 10: 12 }, 3.8025],
  snubDodecahedron: [60, 150, { 3: 80, 5: 12 }, 2.1558],
};

test('catalogue covers the 5 Platonic and 13 Archimedean solids', () => {
  assert.deepEqual(Object.keys(SOLIDS).sort(), Object.keys(EXPECTED).sort());
});

for (const [key, [V, E, faces, R]] of Object.entries(EXPECTED)) {
  test(`${key} has the right structure`, () => {
    const s = buildSolid(key);
    assert.equal(s.vertices.length, V);
    assert.equal(s.edges.length, E);
    assert.deepEqual(s.faceCounts, faces);
    assert.equal(V - E + s.faces.length, 2, 'Euler characteristic');
    assert.ok(Math.abs(s.circumradius - R) < 1e-3, `circumradius ${s.circumradius}`);
    for (const [a, b] of s.edges) assert.ok(Math.abs(distance(s.vertices[a], s.vertices[b]) - 1) < 1e-9);
  });

  test(`${key} faces are regular, planar, outward and counter-clockwise`, () => {
    const s = buildSolid(key);
    for (const f of s.faces) {
      const pts = f.verts.map((i) => s.vertices[i]);
      assert.ok(dot(f.normal, f.center) > 0);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        assert.ok(Math.abs(distance(a, b) - 1) < 1e-9, 'consecutive face vertices share an edge');
        assert.ok(Math.abs(dot(sub(a, f.center), f.normal)) < 1e-9, 'planar');
        const turn = dot(f.normal, [
          (a[1] - f.center[1]) * (b[2] - f.center[2]) - (a[2] - f.center[2]) * (b[1] - f.center[1]),
          (a[2] - f.center[2]) * (b[0] - f.center[0]) - (a[0] - f.center[0]) * (b[2] - f.center[2]),
          (a[0] - f.center[0]) * (b[1] - f.center[1]) - (a[1] - f.center[1]) * (b[0] - f.center[0]),
        ]);
        assert.ok(turn > 0, 'counter-clockwise from outside');
      }
      assert.ok(length(f.center) < s.circumradius);
    }
  });
}

test('vertex configurations', async () => {
  const { vertexConfiguration } = await import('../src/geometry.js');
  const config = (k) => vertexConfiguration(buildSolid(k)).join('.');
  assert.equal(config('cube'), '4.4.4');
  assert.equal(config('truncatedIcosahedron'), '5.6.6');
  assert.equal(config('rhombicuboctahedron'), '3.4.4.4');
  assert.equal(config('rhombicosidodecahedron'), '3.4.5.4');
  assert.equal(config('snubCube'), '3.3.3.3.4');
  assert.equal(config('truncatedIcosidodecahedron'), '4.6.10');
  assert.equal(config('icosidodecahedron'), '3.5.3.5');
});
