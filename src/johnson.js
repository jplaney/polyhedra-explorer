// The 92 Johnson solids: convex polyhedra with regular faces that are not
// vertex-transitive. Importing this module adds them to the catalogue.
//
// 84 are built the way Johnson described them: pyramids, cupolae and the
// pentagonal rotunda stacked on prisms and antiprisms, or caps added to,
// removed from or rotated on Platonic and Archimedean solids. The remaining
// eight have no such construction and are given as vertex coordinates.
//
// Every construction ends in the same hull pass as the other solids, and
// `regularHull` rejects anything that does not come out as a convex solid with
// unit-edge regular faces. Where a construction has a free choice (which way
// round a cap goes on), the candidates are tried and the valid one is kept.

import {
  SOLIDS, FAMILIES, add, sub, scale, dot, cross, length, normalize, distance, axisAngle, mulMatVec,
  findFaces, buildSolid,
} from './geometry.js';
import { IDENTITY, makeInstance, snapOptions, applyTransform } from './snap.js';

const TAU = 2 * Math.PI;
const circumradius = (n) => 1 / (2 * Math.sin(Math.PI / n));
const ring = (n, r, z, phase = 0) =>
  Array.from({ length: n }, (_, k) => [r * Math.cos(phase + (TAU * k) / n), r * Math.sin(phase + (TAU * k) / n), z]);
const rotateZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];

function mergePoints(points) {
  const out = [];
  for (const p of points) if (!out.some((q) => distance(p, q) < 1e-6)) out.push(p);
  return out;
}

const centroid = (pts) => scale(pts.reduce(add, [0, 0, 0]), 1 / pts.length);

/**
 * Hull of a point set if it is a convex polyhedron whose faces are all
 * regular polygons with unit edges, else null.
 */
export function regularHull(points) {
  const pts = mergePoints(points);
  const c = centroid(pts);
  const centred = pts.map((p) => sub(p, c));
  const { faces, edges, edgeLength } = findFaces(centred);
  if (Math.abs(edgeLength - 1) > 1e-6) return null;

  for (const f of faces) {
    const r = circumradius(f.sides);
    for (let i = 0; i < f.sides; i++) {
      const p = centred[f.verts[i]];
      if (Math.abs(distance(p, f.center) - r) > 1e-6) return null;
      if (Math.abs(distance(p, centred[f.verts[(i + 1) % f.sides]]) - 1) > 1e-6) return null;
    }
  }
  // Every edge on exactly two faces, every point a corner of the hull.
  const uses = new Map(edges.map(([a, b]) => [`${a},${b}`, 0]));
  for (const f of faces)
    for (let i = 0; i < f.sides; i++) {
      const a = f.verts[i], b = f.verts[(i + 1) % f.sides];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!uses.has(key)) return null;
      uses.set(key, uses.get(key) + 1);
    }
  if ([...uses.values()].some((n) => n !== 2)) return null;
  if (centred.length - edges.length + faces.length !== 2) return null;
  return { points: centred, faces };
}

// ------------------------------------------------------------ caps and stacks

// A cap sits on a base N-gon in the plane z = 0 (vertex 0 at angle 0) and
// rises towards +z. These are its points above the base.
const CAPS = {
  pyramid: (n) => ({ base: n, points: [[0, 0, Math.sqrt(1 - circumradius(n) ** 2)]] }),
  cupola: (n) => {
    // Each top edge is parallel to every other base edge, so the top n-gon is
    // turned by -pi/2n against the base 2n-gon.
    const rt = circumradius(n), rb = circumradius(2 * n);
    const h = Math.sqrt(1 - (rt * rt + rb * rb - 2 * rt * rb * Math.cos(Math.PI / (2 * n))));
    return { base: 2 * n, points: ring(n, rt, h, -Math.PI / (2 * n)) };
  },
  // Half an icosidodecahedron, cut across a five-fold axis.
  rotunda: () => {
    const s = buildSolid('icosidodecahedron');
    const n = s.faces.find((f) => f.sides === 5).normal;
    const v0 = s.vertices.find((v) => Math.abs(dot(v, n)) < 1e-9);
    const u = normalize(v0), w = cross(n, u);
    const local = s.vertices.map((v) => [dot(v, u), dot(v, w), dot(v, n)]);
    return { base: 10, points: local.filter((p) => p[2] > 1e-9) };
  },
};

const cap = (spec) => (spec[0] === 'rotunda' ? CAPS.rotunda() : CAPS[spec[0]](spec[1]));

// Phase of the polygon at the very top (or bottom) of a stack, so the two
// ends can be compared: aligned ends are "ortho", ends turned by half a step
// are "gyro".
function endsAligned(points) {
  const zs = points.map((p) => p[2]);
  const top = points.filter((p) => p[2] > Math.max(...zs) - 1e-9);
  const bottom = points.filter((p) => p[2] < Math.min(...zs) + 1e-9);
  if (top.length < 3 || top.length !== bottom.length) return null;
  const step = TAU / top.length;
  const angle = (p) => ((Math.atan2(p[1], p[0]) % step) + step) % step;
  const d = Math.abs(angle(top[0]) - angle(bottom[0]));
  return Math.min(d, step - d) < 1e-6;
}

/**
 * A stack along the z axis: an optional bottom cap, an optional prism or
 * antiprism band, and an optional top cap. `ortho` picks how the two caps
 * line up when both are present.
 */
function stack({ bottom, band, top, ortho }) {
  const N = (bottom ? cap(bottom) : cap(top)).base;
  const H = band === 'prism' ? 1 : band === 'antiprism' ? Math.sqrt(1 - (2 * circumradius(N) * Math.sin(Math.PI / (2 * N))) ** 2) : 0;
  const bandTurn = band === 'antiprism' ? Math.PI / N : 0;

  const build = (extraTurn) => {
    const pts = ring(N, circumradius(N), 0);
    if (band) pts.push(...ring(N, circumradius(N), H, bandTurn));
    if (bottom) pts.push(...cap(bottom).points.map(([x, y, z]) => [x, y, -z]));
    if (top) pts.push(...cap(top).points.map((p) => rotateZ([p[0], p[1], p[2] + H], bandTurn + extraTurn)));
    return pts;
  };

  if (!bottom || !top) return build(0);
  const candidates = [build(0), build(TAU / N)];
  if (ortho === undefined) return candidates[0];
  const pick = candidates.find((pts) => endsAligned(pts) === ortho);
  if (!pick) throw new Error('No stack with the requested alignment');
  return pick;
}

// ------------------------------------------------------------ face surgery

const degrees = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
// Angles between pentagon (or vertex) directions of icosahedral solids.
const ICO_META = 180 - (Math.atan(2) * 180) / Math.PI; // 116.57°: neither adjacent nor opposite

// First k of `dirs` that are pairwise `angle` degrees apart.
function pickApart(dirs, k, angle) {
  const n = dirs.length;
  const ok = (i, j) => angle === undefined || Math.abs(degrees(dirs[i], dirs[j]) - angle) < 0.01;
  const search = (chosen, from) => {
    if (chosen.length === k) return chosen;
    for (let i = from; i < n; i++)
      if (chosen.every((j) => ok(i, j))) {
        const found = search([...chosen, i], i + 1);
        if (found) return found;
      }
    return null;
  };
  const found = search([], 0);
  if (!found) throw new Error(`No ${k} directions ${angle}° apart`);
  return found;
}

/**
 * Augment solid `key` by snapping `capKey` onto k faces with `sides` sides,
 * pairwise `angle` degrees apart. Each cap goes on whichever way round keeps
 * the result a valid regular-faced solid.
 */
function augment(key, sides, capKey, k = 1, angle) {
  const inst = makeInstance(key, IDENTITY);
  const candidates = inst.faces.map((f, i) => i).filter((i) => inst.faces[i].sides === sides);
  const tryFaces = (faceIdx) => {
    let points = inst.vertices;
    for (const fi of faceIdx) {
      const next = snapOptions(capKey, inst, fi)
        .map((T) => [...points, ...buildSolid(capKey).vertices.map((v) => applyTransform(T, v))])
        .find((pts) => regularHull(pts));
      if (!next) return null;
      points = next;
    }
    return points;
  };
  // Try face sets in turn until one works (some faces of a Johnson solid
  // can't take a cap without creating coplanar faces).
  const dirs = candidates.map((i) => inst.faces[i].normal);
  const search = (chosen, from) => {
    if (chosen.length === k) return tryFaces(chosen.map((j) => candidates[j]));
    for (let i = from; i < candidates.length; i++) {
      if (angle !== undefined && !chosen.every((j) => Math.abs(degrees(dirs[i], dirs[j]) - angle) < 0.01)) continue;
      const found = search([...chosen, i], i + 1);
      if (found) return found;
    }
    return null;
  };
  const points = search([], 0);
  if (!points) throw new Error(`Cannot augment ${key}`);
  return points;
}

/** Remove the vertices of k icosahedron caps, pairwise `angle` apart. */
function diminishIcosahedron(k, angle) {
  const v = buildSolid('icosahedron').vertices;
  const drop = new Set(pickApart(v.map(normalize), k, angle));
  return v.filter((p, i) => !drop.has(i));
}

/**
 * Rhombicosidodecahedron surgery on pentagonal cupolae: `ops` is a list such
 * as ['remove', 'gyrate'] applied to cupolae whose pentagons are pairwise
 * `angle` apart. Gyrating turns a cupola by 36°, which only moves its
 * pentagon; removing it drops the pentagon and leaves a decagon.
 */
function rhombicosidodecahedron(ops, angle) {
  const s = buildSolid('rhombicosidodecahedron');
  const pentagons = s.faces.filter((f) => f.sides === 5);
  const chosen = pickApart(pentagons.map((f) => f.normal), ops.length, angle).map((i) => pentagons[i]);
  const points = s.vertices.slice();
  const removed = new Set();
  chosen.forEach((f, i) => {
    if (ops[i] === 'remove') f.verts.forEach((v) => removed.add(v));
    else {
      const R = axisAngle(f.normal, Math.PI / 5);
      for (const v of f.verts) points[v] = add(f.center, mulMatVec(R, sub(points[v], f.center)));
    }
  });
  return points.filter((p, i) => !removed.has(i));
}

// ------------------------------------------------------------ sporadic solids

// Vertex coordinates (unit edge) for the eight Johnson solids that are not
// built from simpler pieces. Numerical values as tabulated by David McCooey
// (dmccooey.com/polyhedra), after A. Timofeenko's exact solutions; faces are
// recovered by the hull pass and checked by the tests.
const SPORADIC = {
  84: [
    [0.5, 0, -0.7839309242325636],
    [-0.5, 0, -0.7839309242325636],
    [0, 0.5, 0.7839309242325636],
    [0, -0.5, 0.7839309242325636],
    [0.644584273224155, 0, 0.20556156585325955],
    [-0.644584273224155, 0, 0.20556156585325955],
    [0, 0.644584273224155, -0.20556156585325955],
    [0, -0.644584273224155, -0.20556156585325955],
  ],
  85: [
    [1.2132055458663134, 0, 0.18560702128217985],
    [-1.2132055458663134, 0, 0.18560702128217985],
    [0, 1.2132055458663134, 0.18560702128217985],
    [0, -1.2132055458663134, 0.18560702128217985],
    [0.8578658684551972, 0.8578658684551972, -0.18560702128217985],
    [0.8578658684551972, -0.8578658684551972, -0.18560702128217985],
    [-0.8578658684551972, 0.8578658684551972, -0.18560702128217985],
    [-0.8578658684551972, -0.8578658684551972, -0.18560702128217985],
    [0.7071067811865476, 0, -0.6768685090313561],
    [-0.7071067811865476, 0, -0.6768685090313561],
    [0, 0.7071067811865476, -0.6768685090313561],
    [0, -0.7071067811865476, -0.6768685090313561],
    [0.5, 0.5, 0.6768685090313561],
    [0.5, -0.5, 0.6768685090313561],
    [-0.5, 0.5, 0.6768685090313561],
    [-0.5, -0.5, 0.6768685090313561],
  ],
  86: [
    [0.8527269428464168, 0.5, 0],
    [0.8527269428464168, -0.5, 0],
    [-0.8527269428464168, 0.5, 0],
    [-0.8527269428464168, -0.5, 0],
    [0.5, 0, 0.7909384955799159],
    [-0.5, 0, 0.7909384955799159],
    [0, 0.5, -0.5223569286836385],
    [0, -0.5, -0.5223569286836385],
    [0, 0.7894276266608716, 0.43484297150725437],
    [0, -0.7894276266608716, 0.43484297150725437],
  ],
  88: [
    [0.5, 0.5946333356326385, 0],
    [0.5, -0.5946333356326385, 0],
    [-0.5, 0.5946333356326385, 0],
    [-0.5, -0.5946333356326385, 0],
    [1.283102338831269, 0, -0.18210415445946904],
    [-1.283102338831269, 0, -0.18210415445946904],
    [0.8547430824889651, 0, 0.721504360056562],
    [-0.8547430824889651, 0, 0.721504360056562],
    [0.5, 0, -0.8039970125282816],
    [-0.5, 0, -0.8039970125282816],
    [0, 0.5, 0.8608394343819528],
    [0, -0.5, 0.8608394343819528],
  ],
  89: [
    [0.5, 0.7168448157134568, 0],
    [0.5, -0.7168448157134568, 0],
    [-0.5, 0.7168448157134568, 0],
    [-0.5, -0.7168448157134568, 0],
    [0.5, 0.5, -0.9762060878207004],
    [0.5, -0.5, -0.9762060878207004],
    [-0.5, 0.5, -0.9762060878207004],
    [-0.5, -0.5, -0.9762060878207004],
    [1.101296042047278, 0, -0.35295407633716075],
    [-1.101296042047278, 0, -0.35295407633716075],
    [0.8356590717223669, 0, 0.6111190536673023],
    [-0.8356590717223669, 0, 0.6111190536673023],
    [0, 0.5, 0.8384380274642825],
    [0, -0.5, 0.8384380274642825],
  ],
  90: [
    [0.5, 0.7671311139834615, 0.46294760391536477],
    [0.5, -0.7671311139834615, 0.46294760391536477],
    [-0.5, 0.7671311139834615, 0.46294760391536477],
    [-0.5, -0.7671311139834615, 0.46294760391536477],
    [0.7671311139834615, 0.5, -0.46294760391536477],
    [0.7671311139834615, -0.5, -0.46294760391536477],
    [-0.7671311139834615, 0.5, -0.46294760391536477],
    [-0.7671311139834615, -0.5, -0.46294760391536477],
    [0.5, 0, 1.104437942079934],
    [-0.5, 0, 1.104437942079934],
    [0, 0.5, -1.104437942079934],
    [0, -0.5, -1.104437942079934],
    [1.1264831470789796, 0, 0.3250029759499703],
    [-1.1264831470789796, 0, 0.3250029759499703],
    [0, 1.1264831470789796, -0.3250029759499703],
    [0, -1.1264831470789796, -0.3250029759499703],
  ],
  91: [
    [0.5, 0.8090169943749475, 0.5],
    [0.5, 0.8090169943749475, -0.5],
    [0.5, -0.8090169943749475, 0.5],
    [0.5, -0.8090169943749475, -0.5],
    [-0.5, 0.8090169943749475, 0.5],
    [-0.5, 0.8090169943749475, -0.5],
    [-0.5, -0.8090169943749475, 0.5],
    [-0.5, -0.8090169943749475, -0.5],
    [1.3090169943749475, 0.5, 0],
    [1.3090169943749475, -0.5, 0],
    [-1.3090169943749475, 0.5, 0],
    [-1.3090169943749475, -0.5, 0],
    [0, 0, 0.8090169943749475],
    [0, 0, -0.8090169943749475],
  ],
  92: [
    [1.2373983672655526, -0.38063562148434216, -0.38063562148434216],
    [-0.38063562148434216, 1.2373983672655526, -0.38063562148434216],
    [-0.38063562148434216, -0.38063562148434216, 1.2373983672655526],
    [0.9283813728906053, 0.4283813728906053, -0.8806356214843422],
    [-0.8806356214843422, 0.9283813728906053, 0.4283813728906053],
    [0.4283813728906053, -0.8806356214843422, 0.9283813728906053],
    [0.4283813728906053, -0.8806356214843422, -0.6896526158592896],
    [-0.6896526158592896, 0.4283813728906053, -0.8806356214843422],
    [-0.8806356214843422, -0.6896526158592896, 0.4283813728906053],
    [0.11936437851565786, -0.07161862710939472, -1.1896526158592895],
    [-1.1896526158592895, 0.11936437851565786, -0.07161862710939472],
    [-0.07161862710939472, -1.1896526158592895, 0.11936437851565786],
    [0.9283813728906053, 0.4283813728906053, 0.11936437851565786],
    [0.11936437851565786, 0.9283813728906053, 0.4283813728906053],
    [0.4283813728906053, 0.11936437851565786, 0.9283813728906053],
    [0.9283813728906053, -1.1896526158592895, 0.11936437851565786],
    [0.11936437851565786, 0.9283813728906053, -1.1896526158592895],
    [-1.1896526158592895, 0.11936437851565786, 0.9283813728906053],
  ],
};

// ------------------------------------------------------------ catalogue

const P = (n) => ['pyramid', n];
const C = (n) => ['cupola', n];
const ROT = ['rotunda'];
const META = ICO_META;

// [number, name, group, build]
const JOHNSON = [
  [1, 'Square pyramid', 0, () => stack({ top: P(4) })],
  [2, 'Pentagonal pyramid', 0, () => stack({ top: P(5) })],
  [3, 'Triangular cupola', 0, () => stack({ top: C(3) })],
  [4, 'Square cupola', 0, () => stack({ top: C(4) })],
  [5, 'Pentagonal cupola', 0, () => stack({ top: C(5) })],
  [6, 'Pentagonal rotunda', 0, () => stack({ top: ROT })],

  [7, 'Elongated triangular pyramid', 1, () => stack({ band: 'prism', top: P(3) })],
  [8, 'Elongated square pyramid', 1, () => stack({ band: 'prism', top: P(4) })],
  [9, 'Elongated pentagonal pyramid', 1, () => stack({ band: 'prism', top: P(5) })],
  [10, 'Gyroelongated square pyramid', 1, () => stack({ band: 'antiprism', top: P(4) })],
  [11, 'Gyroelongated pentagonal pyramid', 1, () => stack({ band: 'antiprism', top: P(5) })],
  [12, 'Triangular bipyramid', 1, () => stack({ bottom: P(3), top: P(3) })],
  [13, 'Pentagonal bipyramid', 1, () => stack({ bottom: P(5), top: P(5) })],
  [14, 'Elongated triangular bipyramid', 1, () => stack({ bottom: P(3), band: 'prism', top: P(3) })],
  [15, 'Elongated square bipyramid', 1, () => stack({ bottom: P(4), band: 'prism', top: P(4) })],
  [16, 'Elongated pentagonal bipyramid', 1, () => stack({ bottom: P(5), band: 'prism', top: P(5) })],
  [17, 'Gyroelongated square bipyramid', 1, () => stack({ bottom: P(4), band: 'antiprism', top: P(4) })],
  [18, 'Elongated triangular cupola', 1, () => stack({ band: 'prism', top: C(3) })],
  [19, 'Elongated square cupola', 1, () => stack({ band: 'prism', top: C(4) })],
  [20, 'Elongated pentagonal cupola', 1, () => stack({ band: 'prism', top: C(5) })],
  [21, 'Elongated pentagonal rotunda', 1, () => stack({ band: 'prism', top: ROT })],
  [22, 'Gyroelongated triangular cupola', 1, () => stack({ band: 'antiprism', top: C(3) })],
  [23, 'Gyroelongated square cupola', 1, () => stack({ band: 'antiprism', top: C(4) })],
  [24, 'Gyroelongated pentagonal cupola', 1, () => stack({ band: 'antiprism', top: C(5) })],
  [25, 'Gyroelongated pentagonal rotunda', 1, () => stack({ band: 'antiprism', top: ROT })],

  [26, 'Gyrobifastigium', 2, () => augment('prism3', 4, 'prism3')],
  [27, 'Triangular orthobicupola', 2, () => stack({ bottom: C(3), top: C(3), ortho: true })],
  [28, 'Square orthobicupola', 2, () => stack({ bottom: C(4), top: C(4), ortho: true })],
  [29, 'Square gyrobicupola', 2, () => stack({ bottom: C(4), top: C(4), ortho: false })],
  [30, 'Pentagonal orthobicupola', 2, () => stack({ bottom: C(5), top: C(5), ortho: true })],
  [31, 'Pentagonal gyrobicupola', 2, () => stack({ bottom: C(5), top: C(5), ortho: false })],
  [32, 'Pentagonal orthocupolarotunda', 2, () => stack({ bottom: C(5), top: ROT, ortho: true })],
  [33, 'Pentagonal gyrocupolarotunda', 2, () => stack({ bottom: C(5), top: ROT, ortho: false })],
  [34, 'Pentagonal orthobirotunda', 2, () => stack({ bottom: ROT, top: ROT, ortho: true })],
  [35, 'Elongated triangular orthobicupola', 2, () => stack({ bottom: C(3), band: 'prism', top: C(3), ortho: true })],
  [36, 'Elongated triangular gyrobicupola', 2, () => stack({ bottom: C(3), band: 'prism', top: C(3), ortho: false })],
  [37, 'Elongated square gyrobicupola', 2, () => stack({ bottom: C(4), band: 'prism', top: C(4), ortho: false })],
  [38, 'Elongated pentagonal orthobicupola', 2, () => stack({ bottom: C(5), band: 'prism', top: C(5), ortho: true })],
  [39, 'Elongated pentagonal gyrobicupola', 2, () => stack({ bottom: C(5), band: 'prism', top: C(5), ortho: false })],
  [40, 'Elongated pentagonal orthocupolarotunda', 2, () => stack({ bottom: C(5), band: 'prism', top: ROT, ortho: true })],
  [41, 'Elongated pentagonal gyrocupolarotunda', 2, () => stack({ bottom: C(5), band: 'prism', top: ROT, ortho: false })],
  [42, 'Elongated pentagonal orthobirotunda', 2, () => stack({ bottom: ROT, band: 'prism', top: ROT, ortho: true })],
  [43, 'Elongated pentagonal gyrobirotunda', 2, () => stack({ bottom: ROT, band: 'prism', top: ROT, ortho: false })],
  [44, 'Gyroelongated triangular bicupola', 2, () => stack({ bottom: C(3), band: 'antiprism', top: C(3) })],
  [45, 'Gyroelongated square bicupola', 2, () => stack({ bottom: C(4), band: 'antiprism', top: C(4) })],
  [46, 'Gyroelongated pentagonal bicupola', 2, () => stack({ bottom: C(5), band: 'antiprism', top: C(5) })],
  [47, 'Gyroelongated pentagonal cupolarotunda', 2, () => stack({ bottom: C(5), band: 'antiprism', top: ROT })],
  [48, 'Gyroelongated pentagonal birotunda', 2, () => stack({ bottom: ROT, band: 'antiprism', top: ROT })],

  [49, 'Augmented triangular prism', 3, () => augment('prism3', 4, 'johnson1')],
  [50, 'Biaugmented triangular prism', 3, () => augment('prism3', 4, 'johnson1', 2)],
  [51, 'Triaugmented triangular prism', 3, () => augment('prism3', 4, 'johnson1', 3)],
  [52, 'Augmented pentagonal prism', 3, () => augment('prism5', 4, 'johnson1')],
  [53, 'Biaugmented pentagonal prism', 3, () => augment('prism5', 4, 'johnson1', 2, 144)],
  [54, 'Augmented hexagonal prism', 3, () => augment('prism6', 4, 'johnson1')],
  [55, 'Parabiaugmented hexagonal prism', 3, () => augment('prism6', 4, 'johnson1', 2, 180)],
  [56, 'Metabiaugmented hexagonal prism', 3, () => augment('prism6', 4, 'johnson1', 2, 120)],
  [57, 'Triaugmented hexagonal prism', 3, () => augment('prism6', 4, 'johnson1', 3, 120)],
  [58, 'Augmented dodecahedron', 3, () => augment('dodecahedron', 5, 'johnson2')],
  [59, 'Parabiaugmented dodecahedron', 3, () => augment('dodecahedron', 5, 'johnson2', 2, 180)],
  [60, 'Metabiaugmented dodecahedron', 3, () => augment('dodecahedron', 5, 'johnson2', 2, META)],
  [61, 'Triaugmented dodecahedron', 3, () => augment('dodecahedron', 5, 'johnson2', 3, META)],
  [62, 'Metabidiminished icosahedron', 3, () => diminishIcosahedron(2, META)],
  [63, 'Tridiminished icosahedron', 3, () => diminishIcosahedron(3, META)],
  [64, 'Augmented tridiminished icosahedron', 3, () => augment('johnson63', 3, 'tetrahedron')],
  [65, 'Augmented truncated tetrahedron', 3, () => augment('truncatedTetrahedron', 6, 'johnson3')],
  [66, 'Augmented truncated cube', 3, () => augment('truncatedCube', 8, 'johnson4')],
  [67, 'Biaugmented truncated cube', 3, () => augment('truncatedCube', 8, 'johnson4', 2, 180)],
  [68, 'Augmented truncated dodecahedron', 3, () => augment('truncatedDodecahedron', 10, 'johnson5')],
  [69, 'Parabiaugmented truncated dodecahedron', 3, () => augment('truncatedDodecahedron', 10, 'johnson5', 2, 180)],
  [70, 'Metabiaugmented truncated dodecahedron', 3, () => augment('truncatedDodecahedron', 10, 'johnson5', 2, META)],
  [71, 'Triaugmented truncated dodecahedron', 3, () => augment('truncatedDodecahedron', 10, 'johnson5', 3, META)],
  [72, 'Gyrate rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['gyrate'])],
  [73, 'Parabigyrate rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['gyrate', 'gyrate'], 180)],
  [74, 'Metabigyrate rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['gyrate', 'gyrate'], META)],
  [75, 'Trigyrate rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['gyrate', 'gyrate', 'gyrate'], META)],
  [76, 'Diminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove'])],
  [77, 'Paragyrate diminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'gyrate'], 180)],
  [78, 'Metagyrate diminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'gyrate'], META)],
  [79, 'Bigyrate diminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'gyrate', 'gyrate'], META)],
  [80, 'Parabidiminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'remove'], 180)],
  [81, 'Metabidiminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'remove'], META)],
  [82, 'Gyrate bidiminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'remove', 'gyrate'], META)],
  [83, 'Tridiminished rhombicosidodecahedron', 3, () => rhombicosidodecahedron(['remove', 'remove', 'remove'], META)],

  [84, 'Snub disphenoid', 4, () => SPORADIC[84]],
  [85, 'Snub square antiprism', 4, () => SPORADIC[85]],
  [86, 'Sphenocorona', 4, () => SPORADIC[86]],
  [87, 'Augmented sphenocorona', 4, () => augment('johnson86', 4, 'johnson1')],
  [88, 'Sphenomegacorona', 4, () => SPORADIC[88]],
  [89, 'Hebesphenomegacorona', 4, () => SPORADIC[89]],
  [90, 'Disphenocingulum', 4, () => SPORADIC[90]],
  [91, 'Bilunabirotunda', 4, () => SPORADIC[91]],
  [92, 'Triangular hebesphenorotunda', 4, () => SPORADIC[92]],
];

export const JOHNSON_GROUPS = [
  'Pyramids, cupolae and rotunda',
  'Elongated and gyroelongated',
  'Bicupolae and birotundae',
  'Augmented, diminished and gyrate',
  'Other',
];

const CHIRAL = new Set([44, 45, 46, 47, 48]);

for (const [number, name, group, build] of JOHNSON)
  SOLIDS[`johnson${number}`] = {
    name, family: 'Johnson', group, number, label: `J${number}`, chiral: CHIRAL.has(number),
    vertices: () => {
      const hull = regularHull(build());
      if (!hull) throw new Error(`J${number} did not build as a regular-faced solid`);
      return hull.points;
    },
  };

FAMILIES.push({ name: 'Johnson', note: 'The 92 other convex solids with regular faces.', collapsed: true });
