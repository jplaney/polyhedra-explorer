// Placing solids face-to-face, collision testing and lattice growth.
//
// A placement is an affine transform { R, t } (R row-major 3x3, possibly a
// reflection, t a translation). Instances are a solid plus a transform, with
// world-space data cached for hit-testing and collisions.

import {
  add, sub, scale, dot, cross, length, normalize, distance, mulMatVec, buildSolid,
} from './geometry.js';

const EPS = 1e-6;
// Overlap smaller than this (in edge lengths) counts as touching, not colliding.
export const TOUCH_TOLERANCE = 1e-4;

// ------------------------------------------------------------ transforms

export const IDENTITY = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export const applyTransform = (T, p) => add(mulMatVec(T.R, p), T.t);

function mulMat(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return out;
}

// (A ∘ B)(p) = A(B(p))
export const compose = (A, B) => ({ R: mulMat(A.R, B.R), t: applyTransform(A, B.t) });

export const determinant = (R) =>
  R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);

// Reflection through the plane { x : n·x = d } (n unit).
export function reflectionAcross(n, d) {
  const R = [
    1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[2],
    -2 * n[1] * n[0], 1 - 2 * n[1] * n[1], -2 * n[1] * n[2],
    -2 * n[2] * n[0], -2 * n[2] * n[1], 1 - 2 * n[2] * n[2],
  ];
  return { R, t: scale(n, 2 * d) };
}

const MIRROR_X = { R: [-1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

// ------------------------------------------------------------ instances

let nextId = 1;

export function makeInstance(key, T) {
  const solid = buildSolid(key);
  const vertices = solid.vertices.map((v) => applyTransform(T, v));
  // R is orthogonal, so it maps normals directly (reflections included).
  const faces = solid.faces.map((f) => {
    const normal = mulMatVec(T.R, f.normal);
    const center = applyTransform(T, f.center);
    return { verts: f.verts, sides: f.sides, normal, center, d: dot(normal, center) };
  });
  return {
    id: nextId++,
    key,
    T,
    solid,
    vertices,
    faces,
    center: T.t.slice(),
    radius: solid.circumradius,
    axes: null, // lazily computed collision axes
  };
}

export const faceVertices = (inst, fi) => inst.faces[fi].verts.map((i) => inst.vertices[i]);

// ------------------------------------------------------------ snapping

// Transform taking face `face` of a solid (given local vertices) onto the
// target face: centres coincide, normals oppose, and local vertex `vi` lands
// on target vertex `target.verts[0]`.
function alignFace(vertices, face, vi, target) {
  const us = normalize(sub(vertices[vi], face.center));
  const ns = face.normal;
  const ws = cross(ns, us);
  const ut = normalize(sub(target.verts[0], target.center));
  const nt = scale(target.normal, -1);
  const wt = cross(nt, ut);
  const R = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let k = 0; k < 3; k++) R[i * 3 + k] = ut[i] * us[k] + nt[i] * ns[k] + wt[i] * ws[k];
  return { R, t: sub(target.center, mulMatVec(R, face.center)) };
}

function placementKey(key, T) {
  const solid = buildSolid(key);
  return solid.vertices
    .map((v) => applyTransform(T, v).map((c) => Math.round(c * 1000)).join(','))
    .sort()
    .join(';');
}

/**
 * Every distinct way to attach solid `key` to face `fi` of `inst` so that a
 * face of the same polygon type sits flush against it. Mirror-image
 * placements are included, which only adds new options for chiral solids.
 * When attaching a solid to a copy of itself, the reflection through the
 * shared face (the "natural" mirror-image neighbour) is listed first.
 */
export function snapOptions(key, inst, fi) {
  const solid = buildSolid(key);
  const tf = inst.faces[fi];
  const target = { center: tf.center, normal: tf.normal, verts: faceVertices(inst, fi) };

  const mirrored = solid.vertices.map((v) => applyTransform(MIRROR_X, v));
  const variants = [
    { vertices: solid.vertices, pre: IDENTITY, faces: solid.faces },
    {
      vertices: mirrored,
      pre: MIRROR_X,
      faces: solid.faces.map((f) => ({ ...f, center: applyTransform(MIRROR_X, f.center), normal: applyTransform(MIRROR_X, f.normal) })),
    },
  ];

  const options = new Map();
  for (const { vertices, pre, faces } of variants)
    for (const face of faces) {
      if (face.sides !== tf.sides) continue;
      for (const vi of face.verts) {
        const T = compose(alignFace(vertices, face, vi, target), pre);
        const k = placementKey(key, T);
        if (!options.has(k)) options.set(k, T);
      }
    }

  const list = [...options.values()];
  if (key === inst.key && list.length > 1) {
    const mirror = compose(reflectionAcross(tf.normal, tf.d), inst.T);
    const mk = placementKey(key, mirror);
    const idx = list.findIndex((T) => placementKey(key, T) === mk);
    if (idx > 0) list.unshift(...list.splice(idx, 1));
  }
  return list;
}

// ------------------------------------------------------------ collisions

function uniqueDirections(dirs) {
  const out = [];
  for (const d of dirs) {
    const u = normalize(d);
    if (!out.some((o) => Math.abs(Math.abs(dot(o, u)) - 1) < 1e-9)) out.push(u);
  }
  return out;
}

function collisionAxes(inst) {
  if (!inst.axes) {
    inst.axes = {
      faces: uniqueDirections(inst.faces.map((f) => f.normal)),
      edges: uniqueDirections(inst.solid.edges.map(([a, b]) => sub(inst.vertices[b], inst.vertices[a]))),
    };
  }
  return inst.axes;
}

function separated(axis, A, B) {
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const v of A.vertices) {
    const p = dot(axis, v);
    if (p < minA) minA = p;
    if (p > maxA) maxA = p;
  }
  for (const v of B.vertices) {
    const p = dot(axis, v);
    if (p < minB) minB = p;
    if (p > maxB) maxB = p;
  }
  return maxA <= minB + TOUCH_TOLERANCE || maxB <= minA + TOUCH_TOLERANCE;
}

// Vertices, edge midpoints and face centres.
function samplePoints(inst) {
  if (!inst.samples) {
    inst.samples = [
      ...inst.vertices,
      ...inst.solid.edges.map(([a, b]) => scale(add(inst.vertices[a], inst.vertices[b]), 0.5)),
      ...inst.faces.map((f) => f.center),
    ];
  }
  return inst.samples;
}

const strictlyInside = (p, inst) => inst.faces.every((f) => dot(f.normal, p) < f.d - TOUCH_TOLERANCE);

/** True if two instances overlap with positive volume (touching is fine). */
export function overlaps(A, B) {
  if (distance(A.center, B.center) >= A.radius + B.radius - TOUCH_TOLERANCE) return false;
  if (strictlyInside(A.center, B) || strictlyInside(B.center, A)) return true;

  // Cheap proof of overlap: a sample point of one solid strictly inside the other.
  if (samplePoints(A).some((p) => strictlyInside(p, B)) || samplePoints(B).some((p) => strictlyInside(p, A)))
    return true;

  // Separating axis theorem for convex polyhedra.
  const a = collisionAxes(A), b = collisionAxes(B);
  for (const axis of a.faces) if (separated(axis, A, B)) return false;
  for (const axis of b.faces) if (separated(axis, A, B)) return false;
  for (const ea of a.edges)
    for (const eb of b.edges) {
      const c = cross(ea, eb);
      const len = length(c);
      if (len < EPS) continue;
      if (separated(scale(c, 1 / len), A, B)) return false;
    }
  return true;
}

/** Uniform-grid spatial index over instance centres. */
export class SpatialIndex {
  constructor(cellSize = 8) {
    this.cell = cellSize;
    this.map = new Map();
    this.maxRadius = 0;
  }
  key(i, j, k) {
    return `${i},${j},${k}`;
  }
  cellOf(p) {
    return p.map((c) => Math.floor(c / this.cell));
  }
  insert(inst) {
    const k = this.key(...this.cellOf(inst.center));
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(inst);
    this.maxRadius = Math.max(this.maxRadius, inst.radius);
  }
  remove(inst) {
    const list = this.map.get(this.key(...this.cellOf(inst.center)));
    if (list) {
      const i = list.indexOf(inst);
      if (i >= 0) list.splice(i, 1);
    }
  }
  /** Instances whose centres are within `r + maxRadius` of p. */
  near(p, r) {
    const reach = r + this.maxRadius;
    const lo = this.cellOf(sub(p, [reach, reach, reach]));
    const hi = this.cellOf(add(p, [reach, reach, reach]));
    const out = [];
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = lo[2]; k <= hi[2]; k++) {
          const list = this.map.get(this.key(i, j, k));
          if (list) out.push(...list);
        }
    return out;
  }
  collides(inst, ignore) {
    return this.near(inst.center, inst.radius).some((o) => o !== ignore && overlaps(inst, o));
  }
}

// ------------------------------------------------------------ growth

// Does `cand` have a face lying exactly on face `fi` of `inst`?
function sharesFace(cand, inst, fi) {
  const target = faceVertices(inst, fi);
  const tf = inst.faces[fi];
  return cand.faces.some(
    (f) =>
      f.sides === tf.sides &&
      distance(f.center, tf.center) < 1e-6 &&
      target.every((p) => f.verts.some((i) => distance(cand.vertices[i], p) < 1e-6)),
  );
}

/**
 * Grow a lattice outward from `seeds`. For each face with a side count in
 * `sides`, a copy of the parent solid is placed across that face by either
 * reflecting through the face ('mirror') or translating so the parallel
 * opposite face lands on it ('translate'). Copies that would not sit flush or
 * would collide with anything are skipped. Returns the new instances.
 */
export function grow({ seeds, index, sides, mode = 'mirror', generations = 1, limit = 2000 }) {
  const added = [];
  let frontier = seeds;
  for (let g = 0; g < generations && frontier.length && added.length < limit; g++) {
    const next = [];
    for (const inst of frontier) {
      for (let fi = 0; fi < inst.faces.length && added.length < limit; fi++) {
        const f = inst.faces[fi];
        if (!sides.has(f.sides)) continue;
        const T =
          mode === 'translate'
            ? compose({ R: IDENTITY.R, t: scale(sub(f.center, inst.center), 2) }, inst.T)
            : compose(reflectionAcross(f.normal, f.d), inst.T);
        const cand = makeInstance(inst.key, T);
        if (!sharesFace(cand, inst, fi)) continue;
        if (index.collides(cand)) continue;
        index.insert(cand);
        next.push(cand);
        added.push(cand);
      }
    }
    frontier = next;
  }
  return added;
}
