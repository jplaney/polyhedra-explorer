// Printable tiles with rolling edges and ball-magnet pockets.
//
// A tile is its face polygon swept by a ball: flat on top and bottom, with
// every edge rounded to a half-cylinder and every corner to part of a sphere.
// Two tiles touching along an edge roll on each other's rounded edges, so they
// fold to any angle without their bodies colliding. A loose ball magnet sits
// in a spherical pocket centred on each edge's rounding axis, so neighbouring
// tiles' magnets stay the same distance apart whatever the fold angle, and a
// loose ball turns to attract whichever magnet it meets.

const TAU = 2 * Math.PI;

/**
 * Tile geometry in millimetres for a convex polygon given counter-clockwise
 * in model units (unit edge for the regular faces).
 * Options: edge (mm per model unit), thickness, ballDiameter, clearance,
 * magnetsPerEdge (1 or 2).
 */
export function tileDesign(polygon, { edge = 40, thickness = 7, ballDiameter = 5, clearance = 0.2, magnetsPerEdge = 1 } = {}) {
  const pts = polygon.map(([x, y]) => [x * edge, y * edge]);
  const r = thickness / 2;
  const pocket = ballDiameter / 2 + clearance;
  const along = magnetsPerEdge === 2 ? [0.25, 0.75] : [0.5];
  const magnets = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    for (const t of along) magnets.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r]);
  });
  const wall = r - pocket;
  return { pts, r, thickness, pocket, magnets, wall, pauseAt: r + pocket };
}

// One ring of the tile's side: the polygon pushed out by `o` with each corner
// rounded by `steps` arc segments, at height z. Corner points are shared when
// o is 0 so the caps meet the side without slivers.
function ring(pts, o, z, steps) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const aIn = Math.atan2(-(p[0] - prev[0]), p[1] - prev[1]); // outward normal of the edge into p
    const aOut = Math.atan2(-(next[0] - p[0]), next[1] - p[1]);
    const turn = (((aOut - aIn) % TAU) + TAU) % TAU;
    const corner = o === 0 ? [p[0], p[1], z] : null;
    for (let j = 0; j <= steps; j++) {
      const a = aIn + (turn * j) / steps;
      out.push(corner ?? [p[0] + o * Math.cos(a), p[1] + o * Math.sin(a), z]);
    }
  }
  return out;
}

// Join two rings of equal length (lower, upper) with outward-facing
// triangles, skipping slivers where points are shared.
function band(tris, lower, upper) {
  const n = lower.length;
  for (let j = 0; j < n; j++) {
    const a = lower[j], b = lower[(j + 1) % n], c = upper[(j + 1) % n], d = upper[j];
    if (a !== b) tris.push([a, b, c]);
    if (c !== d) tris.push([a, c, d]);
  }
}

function sphere(tris, [cx, cy, cz], radius, steps = 12) {
  const rings = [];
  for (let k = 0; k <= steps; k++) {
    const phi = -Math.PI / 2 + (Math.PI * k) / steps;
    const pole = k === 0 || k === steps ? [cx, cy, cz + radius * Math.sin(phi)] : null;
    const row = [];
    for (let j = 0; j < 2 * steps; j++) {
      const t = (TAU * j) / (2 * steps);
      row.push(pole ?? [cx + radius * Math.cos(phi) * Math.cos(t), cy + radius * Math.cos(phi) * Math.sin(t), cz + radius * Math.sin(phi)]);
    }
    rings.push(row);
  }
  const shell = [];
  for (let k = 0; k < steps; k++) band(shell, rings[k], rings[k + 1]);
  // A pocket is a hole: its surface faces inward.
  for (const [a, b, c] of shell) tris.push([a, c, b]);
}

/** Triangles of the tile, magnet pockets included, as [[x,y,z] × 3] in mm. */
export function tileTriangles(design, { arcSteps = 6, profileSteps = 8, sphereSteps = 12 } = {}) {
  const { pts, r, magnets, pocket } = design;
  const tris = [];
  const rings = [ring(pts, 0, 0, arcSteps)];
  for (let k = 1; k < 2 * profileSteps; k++) {
    const phi = -Math.PI / 2 + (Math.PI * k) / (2 * profileSteps);
    rings.push(ring(pts, r * Math.cos(phi), r + r * Math.sin(phi), arcSteps));
  }
  rings.push(ring(pts, 0, 2 * r, arcSteps));
  for (let k = 0; k + 1 < rings.length; k++) band(tris, rings[k], rings[k + 1]);
  // The caps reuse the corner points of the first and last rings.
  const corner = (rng, i) => rng[i * (arcSteps + 1)];
  for (let i = 1; i + 1 < pts.length; i++) {
    tris.push([corner(rings[0], 0), corner(rings[0], i + 1), corner(rings[0], i)]);
    tris.push([corner(rings.at(-1), 0), corner(rings.at(-1), i), corner(rings.at(-1), i + 1)]);
  }
  for (const m of magnets) sphere(tris, m, pocket, sphereSteps);
  return tris;
}

/** Binary STL of a list of triangles. */
export function toSTL(tris, name = 'tile') {
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const view = new DataView(buf);
  const header = `Polyhedra Explorer ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    for (const x of n) (view.setFloat32(o, x / len, true), (o += 4));
    for (const p of [a, b, c]) for (const x of p) (view.setFloat32(o, x, true), (o += 4));
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

// ------------------------------------------------------------ zip

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An uncompressed .zip of { name, data: Uint8Array } files. */
export function toZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const fname = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, fname.length, true);
    chunks.push(new Uint8Array(local.buffer), fname, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, fname.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), fname);
    offset += 30 + fname.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) (out.set(c, p), (p += c.length));
  return out;
}
