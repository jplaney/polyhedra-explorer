import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS, buildSolid, distance, describeFaces, add, scale, sub, dot, length } from '../src/geometry.js';
import '../src/catalan.js';
import { IDENTITY, makeInstance, snapOptions, overlaps, grow, SpatialIndex, faceVertices } from '../src/snap.js';
import { dihedralAngles, toDegrees } from '../src/edges.js';

const catalans = () => Object.keys(SOLIDS).filter((k) => SOLIDS[k].family === 'Catalan');

test('one Catalan solid per Archimedean solid, with vertices and faces swapped', () => {
  const keys = catalans();
  assert.equal(keys.length, 13);
  assert.deepEqual(new Set(keys.map((k) => SOLIDS[k].dual)), new Set(Object.keys(SOLIDS).filter((k) => SOLIDS[k].family === 'Archimedean')));
  for (const k of keys) {
    const c = buildSolid(k), a = buildSolid(SOLIDS[k].dual);
    assert.equal(c.vertices.length, a.faces.length, `${c.name} vertices`);
    assert.equal(c.faces.length, a.vertices.length, `${c.name} faces`);
    assert.equal(c.edges.length, a.edges.length, `${c.name} edges`);
  }
});

test('every face of a Catalan solid is the same flat shape', () => {
  for (const k of catalans()) {
    const s = buildSolid(k);
    const shape = (f) => f.verts.map((v) => distance(s.vertices[v], f.center).toFixed(6)).sort().join();
    assert.equal(new Set(s.faces.map(shape)).size, 1, s.name);
    for (const f of s.faces)
      for (const v of f.verts) assert.ok(Math.abs(dot(sub(s.vertices[v], f.center), f.normal)) < 1e-9, `${s.name} planar`);
  }
});

test("Catalan solids share their dual's midsphere: every edge touches it", () => {
  for (const k of catalans()) {
    const s = buildSolid(k), a = buildSolid(SOLIDS[k].dual);
    const [i, j] = a.edges[0];
    const rho = length(scale(add(a.vertices[i], a.vertices[j]), 0.5));
    for (const [p, q] of s.edges) {
      // Closest point of the edge's line to the centre.
      const P = s.vertices[p], d = sub(s.vertices[q], P);
      const t = -dot(P, d) / dot(d, d);
      assert.ok(Math.abs(length(add(P, scale(d, t))) - rho) < 1e-9, s.name);
    }
  }
});

test('Catalan solids have one dihedral angle each, as published', () => {
  const published = {
    triakisTetrahedron: 129.52, rhombicDodecahedron: 120, triakisOctahedron: 147.35, tetrakisHexahedron: 143.13,
    deltoidalIcositetrahedron: 138.12, disdyakisDodecahedron: 155.08, pentagonalIcositetrahedron: 136.31,
    rhombicTriacontahedron: 144, triakisIcosahedron: 160.61, pentakisDodecahedron: 156.72,
    deltoidalHexecontahedron: 154.12, disdyakisTriacontahedron: 164.89, pentagonalHexecontahedron: 153.18,
  };
  for (const [k, deg] of Object.entries(published)) {
    const angles = dihedralAngles(k);
    assert.equal(angles.length, 1, k);
    assert.ok(Math.abs(toDegrees(angles[0].angle) - deg) < 0.01, `${k}: ${toDegrees(angles[0].angle)}`);
  }
});

test('names, labels and chirality', () => {
  const rd = buildSolid('rhombicDodecahedron');
  assert.equal(describeFaces(rd), '12 rhombi');
  assert.equal(SOLIDS.rhombicDodecahedron.label, 'V3.4.3.4');
  assert.equal(SOLIDS.triakisTetrahedron.label, 'V3.6.6');
  assert.equal(SOLIDS.pentagonalHexecontahedron.label, 'V3.3.3.3.5');
  assert.deepEqual(catalans().filter((k) => SOLIDS[k].chiral), ['pentagonalIcositetrahedron', 'pentagonalHexecontahedron']);
});

test('Catalan solids snap only where a face matches exactly', () => {
  const rd = makeInstance('rhombicDodecahedron', IDENTITY);
  const options = snapOptions('rhombicDodecahedron', rd, 0);
  assert.ok(options.length > 0);
  for (const T of options) {
    const b = makeInstance('rhombicDodecahedron', T);
    for (const p of faceVertices(rd, 0)) assert.ok(b.vertices.some((v) => distance(v, p) < 1e-6));
  }
  // A square is not a rhombus, and an equilateral triangle is not isosceles.
  assert.equal(snapOptions('cube', rd, 0).length, 0);
  const tt = makeInstance('triakisTetrahedron', IDENTITY);
  assert.equal(snapOptions('tetrahedron', tt, 0).length, 0);
  assert.ok(snapOptions('triakisTetrahedron', tt, 0).length > 0);
});

test('rhombic dodecahedra fill space', () => {
  const seed = makeInstance('rhombicDodecahedron', IDENTITY);
  const index = new SpatialIndex();
  index.insert(seed);
  const added = grow({ seeds: [seed], index, sides: new Set([4]), mode: 'translate', generations: 2 });
  assert.equal(added.slice(0, 12).length, 12, 'twelve neighbours, one per face');
  // Each cell of the honeycomb touches 12 others; the 2-step ball of the FCC lattice has 1 + 12 + 42 cells.
  assert.equal(added.length, 12 + 42);
  const all = [seed, ...added];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) assert.equal(overlaps(all[i], all[j]), false);
});
