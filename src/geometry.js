// Platonic and Archimedean solid geometry.
//
// Every solid is generated from vertex coordinates, centred on the origin and
// scaled to unit edge length. Faces are recovered by a small convex-hull pass
// (see findFaces), so the only per-solid data is a vertex recipe.
//
// This module has no dependencies so it can be unit-tested under Node.

export const PHI = (1 + Math.sqrt(5)) / 2;
const SQRT2 = Math.SQRT2;

// ---------------------------------------------------------------- vectors

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / length(a));
export const distance = (a, b) => length(sub(a, b));

// ------------------------------------------------------- vertex recipes

const cyclicPerms = ([x, y, z]) => [[x, y, z], [y, z, x], [z, x, y]];
const allPerms = ([x, y, z]) => [
  [x, y, z], [y, z, x], [z, x, y],
  [x, z, y], [z, y, x], [y, x, z],
];

// All sign changes of a point. `parity` optionally keeps only points with an
// even or odd number of negated (non-zero) coordinates.
function signChanges(p, parity) {
  const out = [];
  for (let mask = 0; mask < 8; mask++) {
    let flips = 0;
    const q = p.map((c, i) => {
      if (mask & (1 << i)) {
        if (c === 0) return NaN; // skip duplicate -0 variants
        flips++;
        return -c;
      }
      return c;
    });
    if (q.some(Number.isNaN)) continue;
    if (parity === 'even' && flips % 2) continue;
    if (parity === 'odd' && !(flips % 2)) continue;
    out.push(q);
  }
  return out;
}

function dedupe(points) {
  const seen = new Map();
  for (const p of points) {
    const key = p.map((c) => Math.round(c * 1e6)).join(',');
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

// Expand base points with permutations ('cyclic' or 'all') and sign changes.
function expand(bases, perms = 'cyclic', parity) {
  const permute = perms === 'all' ? allPerms : cyclicPerms;
  const pts = [];
  for (const b of bases) for (const s of signChanges(b, parity)) pts.push(...permute(s));
  return dedupe(pts);
}

// Rotation matrix (row-major 3x3) about a unit axis.
export function axisAngle(axis, angle) {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

export const mulMatVec = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

// Closure of a point under a set of rotation matrices.
function orbit(p, generators) {
  const key = (q) => q.map((c) => Math.round(c * 1e6)).join(',');
  const seen = new Map([[key(p), p]]);
  const queue = [p];
  while (queue.length) {
    const q = queue.pop();
    for (const g of generators) {
      const r = mulMatVec(g, q);
      const k = key(r);
      if (!seen.has(k)) {
        seen.set(k, r);
        queue.push(r);
      }
    }
  }
  return [...seen.values()];
}

// Snub cube / snub dodecahedron, built numerically.
//
// Take a vertex axis (k-fold), an adjacent face axis (3-fold) and an adjacent
// edge axis (2-fold) of the octahedron or icosahedron. The snub vertex p is the
// point whose images under the three rotations are all the same distance away;
// its orbit under the rotation group gives every vertex. For a rotation by
// 2*pi/k about axis a, |p - Rp| = 2 sin(pi/k) |p x a|.
function snubVertices(baseKey) {
  const base = buildSolid(baseKey);
  const face = base.faces[0];
  const v0 = base.vertices[face.verts[0]];
  const v1 = base.vertices[face.verts[1]];
  const k = base.vertexDegree;
  const axes = [normalize(v0), normalize(face.center), normalize(add(v0, v1))];
  const orders = [k, 3, 2];

  const point = ([w0, w1]) =>
    normalize(add(add(scale(axes[0], w0), scale(axes[1], w1)), scale(axes[2], 1 - w0 - w1)));
  const residual = (w) => {
    const p = point(w);
    const g = axes.map((a, i) => Math.sin(Math.PI / orders[i]) * length(cross(p, a)));
    return [g[0] - g[1], g[1] - g[2]];
  };

  // Newton's method with a finite-difference Jacobian, from the triangle's centre.
  let w = [1 / 3, 1 / 3];
  for (let iter = 0; iter < 100; iter++) {
    const f = residual(w);
    if (Math.hypot(f[0], f[1]) < 1e-14) break;
    const h = 1e-7;
    const fa = residual([w[0] + h, w[1]]);
    const fb = residual([w[0], w[1] + h]);
    const J = [(fa[0] - f[0]) / h, (fb[0] - f[0]) / h, (fa[1] - f[1]) / h, (fb[1] - f[1]) / h];
    const det = J[0] * J[3] - J[1] * J[2];
    w = [w[0] - (J[3] * f[0] - J[1] * f[1]) / det, w[1] - (-J[2] * f[0] + J[0] * f[1]) / det];
  }

  const gens = [axisAngle(axes[0], (2 * Math.PI) / k), axisAngle(axes[1], (2 * Math.PI) / 3)];
  return orbit(point(w), gens);
}

// --------------------------------------------------------------- catalogue

const r2 = SQRT2;
const P = PHI;

export const SOLIDS = {
  // Platonic
  tetrahedron: {
    name: 'Tetrahedron', family: 'Platonic',
    vertices: () => expand([[1, 1, 1]], 'cyclic', 'even'),
  },
  cube: {
    name: 'Cube', family: 'Platonic',
    vertices: () => expand([[1, 1, 1]]),
  },
  octahedron: {
    name: 'Octahedron', family: 'Platonic',
    vertices: () => expand([[1, 0, 0]]),
  },
  dodecahedron: {
    name: 'Dodecahedron', family: 'Platonic',
    vertices: () => expand([[1, 1, 1], [0, 1 / P, P]]),
  },
  icosahedron: {
    name: 'Icosahedron', family: 'Platonic',
    vertices: () => expand([[0, 1, P]]),
  },

  // Archimedean
  truncatedTetrahedron: {
    name: 'Truncated tetrahedron', family: 'Archimedean',
    vertices: () => expand([[3, 1, 1]], 'all', 'even'),
  },
  cuboctahedron: {
    name: 'Cuboctahedron', family: 'Archimedean',
    vertices: () => expand([[1, 1, 0]], 'all'),
  },
  truncatedCube: {
    name: 'Truncated cube', family: 'Archimedean',
    vertices: () => expand([[r2 - 1, 1, 1]], 'all'),
  },
  truncatedOctahedron: {
    name: 'Truncated octahedron', family: 'Archimedean',
    vertices: () => expand([[0, 1, 2]], 'all'),
  },
  rhombicuboctahedron: {
    name: 'Rhombicuboctahedron', family: 'Archimedean',
    vertices: () => expand([[1, 1, 1 + r2]], 'all'),
  },
  truncatedCuboctahedron: {
    name: 'Truncated cuboctahedron', family: 'Archimedean',
    vertices: () => expand([[1, 1 + r2, 1 + 2 * r2]], 'all'),
  },
  snubCube: {
    name: 'Snub cube', family: 'Archimedean', chiral: true,
    vertices: () => snubVertices('octahedron'),
  },
  icosidodecahedron: {
    name: 'Icosidodecahedron', family: 'Archimedean',
    vertices: () => expand([[0, 0, P], [1 / 2, P / 2, (P * P) / 2]]),
  },
  truncatedDodecahedron: {
    name: 'Truncated dodecahedron', family: 'Archimedean',
    vertices: () => expand([[0, 1 / P, 2 + P], [1 / P, P, 2 * P], [P, 2, P * P]]),
  },
  truncatedIcosahedron: {
    name: 'Truncated icosahedron', family: 'Archimedean',
    vertices: () => expand([[0, 1, 3 * P], [1, 2 + P, 2 * P], [P, 2, P * P * P]]),
  },
  rhombicosidodecahedron: {
    name: 'Rhombicosidodecahedron', family: 'Archimedean',
    vertices: () => expand([[1, 1, P * P * P], [P * P, P, 2 * P], [2 + P, 0, P * P]]),
  },
  truncatedIcosidodecahedron: {
    name: 'Truncated icosidodecahedron', family: 'Archimedean',
    vertices: () => expand([
      [1 / P, 1 / P, 3 + P],
      [2 / P, P, 1 + 2 * P],
      [1 / P, P * P, -1 + 3 * P],
      [2 * P - 1, 2, 2 + P],
      [P, 3, 2 * P],
    ]),
  },
  snubDodecahedron: {
    name: 'Snub dodecahedron', family: 'Archimedean', chiral: true,
    vertices: () => snubVertices('icosahedron'),
  },
};

export const POLYGON_NAMES = {
  3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon', 8: 'octagon', 10: 'decagon',
};

// --------------------------------------------------------------- hull

// Recover the polygonal faces of a convex polyhedron whose vertices lie on a
// sphere and whose edges all have the same (shortest) length.
export function findFaces(vertices) {
  const n = vertices.length;
  let edgeLen = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) edgeLen = Math.min(edgeLen, distance(vertices[i], vertices[j]));

  const tol = 1e-6 * edgeLen;
  const neighbors = vertices.map(() => []);
  const edges = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.abs(distance(vertices[i], vertices[j]) - edgeLen) < tol) {
        neighbors[i].push(j);
        neighbors[j].push(i);
        edges.push([i, j]);
      }

  const faces = new Map();
  for (const [a, b] of edges)
    for (const c of neighbors[b]) {
      if (c === a) continue;
      const A = vertices[a], B = vertices[b], C = vertices[c];
      let normal = cross(sub(B, A), sub(C, B));
      if (length(normal) < tol) continue;
      normal = normalize(normal);
      if (dot(normal, A) < 0) normal = scale(normal, -1);
      const d = dot(normal, A);
      if (vertices.some((v) => dot(normal, v) > d + tol)) continue; // not a supporting plane

      const key = normal.map((x) => Math.round(x * 1e5)).join(',');
      if (faces.has(key)) continue;
      const verts = [];
      for (let i = 0; i < n; i++) if (Math.abs(dot(normal, vertices[i]) - d) < tol) verts.push(i);
      faces.set(key, { verts, normal });
    }

  const result = [...faces.values()].map(({ verts, normal }) => {
    const center = scale(verts.reduce((s, i) => add(s, vertices[i]), [0, 0, 0]), 1 / verts.length);
    // Order vertices counter-clockwise when seen from outside.
    const u = normalize(sub(vertices[verts[0]], center));
    const w = cross(normal, u);
    const angle = (i) => {
      const r = sub(vertices[i], center);
      return Math.atan2(dot(r, w), dot(r, u));
    };
    verts.sort((i, j) => angle(i) - angle(j));
    return { verts, normal, center, sides: verts.length };
  });

  return { faces: result, edges, edgeLength: edgeLen, vertexDegree: neighbors[0].length };
}

// --------------------------------------------------------------- builder

const cache = new Map();

export function buildSolid(key) {
  if (cache.has(key)) return cache.get(key);
  const def = SOLIDS[key];
  if (!def) throw new Error(`Unknown solid: ${key}`);

  const raw = def.vertices();
  const hull = findFaces(raw);
  const vertices = raw.map((v) => scale(v, 1 / hull.edgeLength));
  const { faces, edges, vertexDegree } = findFaces(vertices);

  // Sort so faces of the same kind are grouped, largest first.
  faces.sort((a, b) => b.sides - a.sides);

  const faceCounts = {};
  for (const f of faces) faceCounts[f.sides] = (faceCounts[f.sides] || 0) + 1;

  const solid = {
    key,
    name: def.name,
    family: def.family,
    chiral: !!def.chiral,
    vertices,
    faces,
    edges,
    vertexDegree,
    faceCounts,
    circumradius: length(vertices[0]),
  };
  cache.set(key, solid);
  return solid;
}

// Vertex configuration, e.g. [5, 6, 6] for the truncated icosahedron: the
// faces met in order around a vertex, written in its lexicographically
// smallest rotation or reflection.
export function vertexConfiguration(solid) {
  const around = solid.faces.filter((f) => f.verts.includes(0));
  const next = (f) => f.verts[(f.verts.indexOf(0) + 1) % f.sides];
  const prev = (f) => f.verts[(f.verts.indexOf(0) + f.sides - 1) % f.sides];
  const ring = [];
  let f = around[0];
  do {
    ring.push(f.sides);
    const n = next(f);
    f = around.find((g) => prev(g) === n);
  } while (f !== around[0] && ring.length <= around.length);

  const candidates = [];
  for (const seq of [ring, [...ring].reverse()])
    for (let i = 0; i < seq.length; i++) candidates.push([...seq.slice(i), ...seq.slice(0, i)]);
  candidates.sort((a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return candidates[0];
}

export function describeFaces(solid) {
  return Object.entries(solid.faceCounts)
    .sort((a, b) => a[0] - b[0])
    .map(([sides, count]) => `${count} ${POLYGON_NAMES[sides] ?? `${sides}-gon`}${count > 1 ? 's' : ''}`)
    .join(', ');
}
