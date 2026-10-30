// Angles around an edge.
//
// Solids that share an edge fan around it like pages around a book's spine.
// Each fills a wedge whose size is its dihedral angle there (the angle between
// its two faces at that edge). Space closes up around the edge only when the
// wedges add up to exactly 360°; whatever is left over is the gap.

import { add, sub, scale, dot, cross, normalize, distance, buildSolid, POLYGON_NAMES } from './geometry.js';
import { makeInstance, snapOptions } from './snap.js';

const TAU = 2 * Math.PI;
export const toDegrees = (r) => (r * 180) / Math.PI;
const wrap = (a) => ((a % TAU) + TAU) % TAU;
// Gaps and overlaps smaller than this (radians) count as closed.
export const ANGLE_TOLERANCE = 1e-6;

/** The two faces of `inst` that meet along the edge from a to b, or null if a–b isn't one of its edges. */
export function findEdge(inst, a, b) {
  const i = inst.vertices.findIndex((v) => distance(v, a) < 1e-6);
  const j = inst.vertices.findIndex((v) => distance(v, b) < 1e-6);
  if (i < 0 || j < 0) return null;
  const faces = [];
  inst.faces.forEach((f, fi) => {
    const k = f.verts.indexOf(i);
    if (k >= 0 && (f.verts[(k + 1) % f.sides] === j || f.verts[(k + f.sides - 1) % f.sides] === j)) faces.push(fi);
  });
  return faces.length === 2 ? { i, j, faces } : null;
}

/** Axis along the edge and two directions spanning the plane across it. */
export function edgeFrame(a, b) {
  const axis = normalize(sub(b, a));
  const helper = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(axis, helper));
  return { a, b, axis, mid: scale(add(a, b), 0.5), u, w: cross(axis, u) };
}

const angleAround = (frame, p) => {
  const d = sub(p, frame.mid);
  return wrap(Math.atan2(dot(d, frame.w), dot(d, frame.u)));
};

/**
 * The wedge a solid fills around the edge, counter-clockwise about the axis:
 * { start, size } in radians, with the faces at each end. The solid's centre
 * lies inside its wedge, which tells the inside from the outside.
 */
export function wedgeOf(inst, frame, edge) {
  const [f1, f2] = edge.faces;
  const t1 = angleAround(frame, inst.faces[f1].center);
  const t2 = angleAround(frame, inst.faces[f2].center);
  const span = wrap(t2 - t1);
  if (wrap(angleAround(frame, inst.center) - t1) < span) return { start: t1, size: span, startFace: f1, endFace: f2 };
  return { start: t2, size: TAU - span, startFace: f2, endFace: f1 };
}

/**
 * Everything around the edge a–b: the wedge of each instance that has it as an
 * edge, sorted counter-clockwise, and the gap after each wedge (negative where
 * neighbouring wedges overlap).
 */
export function edgeFan(instances, a, b) {
  const frame = edgeFrame(a, b);
  const wedges = [];
  for (const inst of instances) {
    const edge = findEdge(inst, a, b);
    if (edge) wedges.push({ inst, ...wedgeOf(inst, frame, edge) });
  }
  wedges.sort((x, y) => x.start - y.start);
  const gaps = wedges.map((w, k) => {
    const next = wedges[(k + 1) % wedges.length];
    let size = next.start - (w.start + w.size);
    if (k === wedges.length - 1) size += TAU;
    return { after: w, start: w.start + w.size, size: Math.abs(size) < ANGLE_TOLERANCE ? 0 : size };
  });
  const filled = wedges.reduce((s, w) => s + w.size, 0);
  return { frame, wedges, gaps, filled };
}

/** Dihedral angle of `inst` at its edge a–b, in radians. */
export function dihedralAt(inst, a, b) {
  const edge = findEdge(inst, a, b);
  return edge ? wedgeOf(inst, edgeFrame(a, b), edge).size : null;
}

const faceName = (n) => POLYGON_NAMES[n] ?? `${n}-gon`;

/** A solid's distinct dihedral angles, each with the face pair it sits between. */
export function dihedralAngles(key) {
  const s = buildSolid(key);
  const inst = { vertices: s.vertices, faces: s.faces, center: [0, 0, 0] };
  const found = new Map();
  for (const [i, j] of s.edges) {
    const a = s.vertices[i], b = s.vertices[j];
    const edge = findEdge(inst, a, b);
    const angle = wedgeOf(inst, edgeFrame(a, b), edge).size;
    const sides = edge.faces.map((fi) => s.faces[fi].sides).sort((x, y) => x - y);
    const id = `${toDegrees(angle).toFixed(4)}|${sides}`;
    if (!found.has(id)) found.set(id, { angle, between: sides.map(faceName).join('–') });
  }
  return [...found.values()].sort((x, y) => x.angle - y.angle);
}

/**
 * Distinct dihedral angles across a set of solids, each listing the solids
 * that have it (in the order given): [{ angle, keys }] sorted by angle.
 */
export function angleLibrary(keys) {
  const byAngle = new Map();
  for (const key of keys)
    for (const { angle } of dihedralAngles(key)) {
      const id = toDegrees(angle).toFixed(3);
      if (!byAngle.has(id)) byAngle.set(id, { angle, keys: [] });
      const entry = byAngle.get(id);
      if (!entry.keys.includes(key)) entry.keys.push(key);
    }
  return [...byAngle.values()].sort((x, y) => x.angle - y.angle);
}

/**
 * Ways to close a gap exactly with up to `maxPieces` dihedral angles from the
 * library (repeats allowed), ranked by `rank` (lower is more familiar).
 */
export function exactFills(gap, library, { maxPieces = 3, tolerance = 1e-4, limit = 5, rank = () => 0 } = {}) {
  if (gap < tolerance) return [];
  const found = [];
  const search = (from, left, chosen) => {
    if (Math.abs(left) < tolerance) return void found.push(chosen);
    if (chosen.length === maxPieces) return;
    for (let i = from; i < library.length; i++) {
      if (library[i].angle > left + tolerance) break;
      search(i, left - library[i].angle, [...chosen, library[i]]);
    }
  };
  search(0, gap, []);
  // A single solid that fits exactly comes first; otherwise the most familiar
  // solids (lowest rank), then the fewest pieces.
  const score = (combo) => combo.reduce((s, e) => s + Math.min(...e.keys.map(rank)), 0);
  const single = (combo) => (combo.length === 1 ? 0 : 1);
  return found.sort((x, y) => single(x) - single(y) || score(x) - score(y) || x.length - y.length).slice(0, limit);
}

/**
 * Ways to put solid `key` into a gap: snapped onto the face at the start of
 * the gap, so it shares the edge. Each comes with the angle it takes up.
 */
export function gapPlacements(key, gap, frame) {
  const { inst, endFace } = gap.after;
  return snapOptions(key, inst, endFace)
    .map((T) => {
      const cand = makeInstance(key, T);
      return { T, cand, angle: dihedralAt(cand, frame.a, frame.b) };
    })
    .filter((o) => o.angle !== null);
}
