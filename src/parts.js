// Parts list: the physical tiles a scene needs.
//
// Every face of every solid is a tile, except that where two solids sit face
// to face the shared face is one tile, not two. Regular faces with the same
// number of sides are interchangeable (all solids here have unit edges); a
// Catalan solid's faces are their own shape, shared only with copies of that
// solid.

import { sub, dot, cross, normalize, faceNoun } from './geometry.js';

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

/** Which tile a face needs: interchangeable regular polygons share a type. */
function tileType(inst, face) {
  const s = inst.solid;
  if (!s.faceName) return { id: `regular-${face.sides}`, label: capitalize(faceNoun(s, face.sides)[0]) };
  return { id: `face-${s.key}`, label: `${capitalize(s.faceName[0])} (${s.name.toLowerCase()})` };
}

/**
 * The face's corners in its own plane, counter-clockwise, centred on the
 * vertex average, in model units.
 */
export function facePolygon(inst, fi) {
  const f = inst.faces[fi];
  const pts = f.verts.map((i) => inst.vertices[i]);
  const u = normalize(sub(pts[0], f.center));
  const w = cross(f.normal, u);
  return pts.map((p) => {
    const d = sub(p, f.center);
    return [dot(d, u), dot(d, w)];
  });
}

const faceKey = (inst, f) =>
  f.verts
    .map((i) => inst.vertices[i].map((c) => Math.round(c * 1e4)).join(','))
    .sort()
    .join(';');

/**
 * Tiles needed for a set of placed solids:
 * { types: [{ id, label, sides, count, polygon }], total, shared }, with
 * types ordered by number of sides. `shared` counts faces two solids share.
 */
export function partsList(instances) {
  const seen = new Set();
  const types = new Map();
  let shared = 0;
  for (const inst of instances)
    inst.faces.forEach((f, fi) => {
      const key = faceKey(inst, f);
      if (seen.has(key)) return void shared++;
      seen.add(key);
      const { id, label } = tileType(inst, f);
      if (!types.has(id)) types.set(id, { id, label, sides: f.sides, count: 0, polygon: facePolygon(inst, fi) });
      types.get(id).count++;
    });
  const list = [...types.values()].sort((a, b) => a.sides - b.sides || a.label.localeCompare(b.label));
  return { types: list, total: list.reduce((s, t) => s + t.count, 0), shared };
}
