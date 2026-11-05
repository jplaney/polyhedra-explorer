// The 13 Catalan solids: the duals of the Archimedean solids. Importing this
// module adds them to the catalogue.
//
// Each is built by polar reciprocation in the Archimedean solid's midsphere
// (the sphere touching the middle of every edge): every face becomes a vertex
// and every vertex a face. The faces are all alike but not regular, so these
// solids snap to copies of themselves rather than to the regular-faced ones.

import { SOLIDS, FAMILIES, buildSolid, add, scale, dot, length, vertexConfiguration } from './geometry.js';

/** Vertices and faces of the dual of solid `key`, sharing its midsphere. */
export function dual(key) {
  const s = buildSolid(key);
  const [a, b] = s.edges[0];
  const rho = length(scale(add(s.vertices[a], s.vertices[b]), 0.5)); // midradius
  // The face plane n·x = d becomes the vertex n·rho²/d.
  const vertices = s.faces.map((f) => scale(f.normal, (rho * rho) / dot(f.normal, f.center)));
  // Each vertex becomes the face through the new vertices of the faces
  // around it, taken in order around the vertex.
  const faces = s.vertices.map((v, vi) => {
    const around = s.faces.map((f, fi) => fi).filter((fi) => s.faces[fi].verts.includes(vi));
    const after = (fi) => {
      const f = s.faces[fi];
      return f.verts[(f.verts.indexOf(vi) + 1) % f.sides];
    };
    const before = (fi) => {
      const f = s.faces[fi];
      return f.verts[(f.verts.indexOf(vi) + f.sides - 1) % f.sides];
    };
    const ring = [around[0]];
    while (ring.length < around.length) ring.push(around.find((fi) => before(fi) === after(ring.at(-1))));
    return ring;
  });
  return { vertices, faces };
}

// [key, name, dual of, face name (singular, plural)]
const CATALAN = [
  ['triakisTetrahedron', 'Triakis tetrahedron', 'truncatedTetrahedron', ['isosceles triangle', 'isosceles triangles']],
  ['rhombicDodecahedron', 'Rhombic dodecahedron', 'cuboctahedron', ['rhombus', 'rhombi']],
  ['triakisOctahedron', 'Triakis octahedron', 'truncatedCube', ['isosceles triangle', 'isosceles triangles']],
  ['tetrakisHexahedron', 'Tetrakis hexahedron', 'truncatedOctahedron', ['isosceles triangle', 'isosceles triangles']],
  ['deltoidalIcositetrahedron', 'Deltoidal icositetrahedron', 'rhombicuboctahedron', ['kite', 'kites']],
  ['disdyakisDodecahedron', 'Disdyakis dodecahedron', 'truncatedCuboctahedron', ['scalene triangle', 'scalene triangles']],
  ['pentagonalIcositetrahedron', 'Pentagonal icositetrahedron', 'snubCube', ['irregular pentagon', 'irregular pentagons']],
  ['rhombicTriacontahedron', 'Rhombic triacontahedron', 'icosidodecahedron', ['rhombus', 'rhombi']],
  ['triakisIcosahedron', 'Triakis icosahedron', 'truncatedDodecahedron', ['isosceles triangle', 'isosceles triangles']],
  ['pentakisDodecahedron', 'Pentakis dodecahedron', 'truncatedIcosahedron', ['isosceles triangle', 'isosceles triangles']],
  ['deltoidalHexecontahedron', 'Deltoidal hexecontahedron', 'rhombicosidodecahedron', ['kite', 'kites']],
  ['disdyakisTriacontahedron', 'Disdyakis triacontahedron', 'truncatedIcosidodecahedron', ['scalene triangle', 'scalene triangles']],
  ['pentagonalHexecontahedron', 'Pentagonal hexecontahedron', 'snubDodecahedron', ['irregular pentagon', 'irregular pentagons']],
];

for (const [key, name, of, faceName] of CATALAN)
  SOLIDS[key] = {
    name,
    family: 'Catalan',
    dual: of,
    faceName,
    chiral: SOLIDS[of].chiral,
    // Face configuration: the Archimedean vertex configuration with a V, e.g.
    // V3.6.6 — each face's corners meet 3, 6 and 6 faces.
    get label() {
      return `V${vertexConfiguration(buildSolid(of)).join('.')}`;
    },
    polyhedron: () => dual(of),
  };

// List the Catalan solids right after the Archimedean ones they're dual to.
FAMILIES.splice(FAMILIES.findIndex((f) => f.name === 'Archimedean') + 1, 0, {
  name: 'Catalan',
  note: 'Duals of the Archimedean solids: every face alike, but not regular.',
});
