import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SOLIDS, FAMILIES, POLYGON_NAMES, buildSolid, describeFaces, vertexConfiguration } from './geometry.js';
import { IDENTITY, makeInstance, snapOptions, SpatialIndex, grow, faceVertices } from './snap.js';
import { JOHNSON_GROUPS } from './johnson.js';

const MAX_SOLIDS = 1500;
const STORAGE_KEY = 'polyhedra-explorer:v1';
const FACE_TOKENS = { 3: '--tri', 4: '--sq', 5: '--pent', 6: '--hex', 8: '--oct', 10: '--dec' };

const $ = (sel) => document.querySelector(sel);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const polygon = (n) => POLYGON_NAMES[n] ?? `${n}-gon`;

// ------------------------------------------------------------ three.js setup

const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
camera.position.set(6, 4.5, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 1, 0.8);
camera.add(sun); // light follows the viewer so every face stays readable
scene.add(camera);

const solidMat = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.05,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
const ghostMat = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false,
});
const ghostEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
const highlightMat = new THREE.LineBasicMaterial({ depthTest: false });
// Drawn over a solid that a click would remove; pulled forward so it wins
// the depth test against the solid's own faces.
const removalMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0.55, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
});
const removalEdgeMat = new THREE.LineBasicMaterial();

const solidsGroup = new THREE.Group();
scene.add(solidsGroup);

function applyTheme() {
  scene.background = new THREE.Color(cssVar('--stage'));
  edgeMat.color.set(cssVar('--edge'));
  highlightMat.color.set(cssVar('--hilite'));
  removalMat.color.set(cssVar('--blocked'));
  removalEdgeMat.color.set(cssVar('--blocked'));
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ------------------------------------------------------------ geometry cache

const geometryCache = new Map();

function solidGeometry(key) {
  if (geometryCache.has(key)) return geometryCache.get(key);
  const s = buildSolid(key);
  const positions = [], colors = [], triFace = [];
  s.faces.forEach((f, fi) => {
    const color = new THREE.Color(cssVar(FACE_TOKENS[f.sides]) || '#999');
    for (let i = 1; i < f.sides - 1; i++) {
      for (const vi of [f.verts[0], f.verts[i], f.verts[i + 1]]) {
        positions.push(...s.vertices[vi]);
        colors.push(color.r, color.g, color.b);
      }
      triFace.push(fi);
    }
  });
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mesh.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh.computeVertexNormals();

  const edgePositions = [];
  for (const [a, b] of s.edges) edgePositions.push(...s.vertices[a], ...s.vertices[b]);
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));

  const g = { mesh, edges, triFace };
  geometryCache.set(key, g);
  return g;
}

const toMatrix4 = ({ R, t }) =>
  new THREE.Matrix4().set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1);

function setTransform(obj, T) {
  obj.matrixAutoUpdate = false;
  obj.matrix.copy(toMatrix4(T));
  obj.matrixWorldNeedsUpdate = true;
}

// ------------------------------------------------------------ state

const state = {
  selected: 'truncatedIcosahedron',
  instances: [],
  index: new SpatialIndex(),
  hover: null, // { inst, fi, options: [{ T, blocked }], choice }
  removal: null, // instance a click would remove while Shift or Alt is held
  allowOverlap: false,
  undo: [],
};

function addInstance(inst) {
  const g = solidGeometry(inst.key);
  const mesh = new THREE.Mesh(g.mesh, solidMat);
  mesh.add(new THREE.LineSegments(g.edges, edgeMat));
  setTransform(mesh, inst.T);
  mesh.userData.inst = inst;
  inst.object = mesh;
  solidsGroup.add(mesh);
  state.instances.push(inst);
  state.index.insert(inst);
}

function removeInstance(inst) {
  solidsGroup.remove(inst.object);
  state.index.remove(inst);
  state.instances.splice(state.instances.indexOf(inst), 1);
}

const snapshot = () => state.instances.map(({ key, T }) => ({ key, T }));

function restore(snap) {
  solidsGroup.clear();
  state.instances = [];
  state.index = new SpatialIndex();
  for (const { key, T } of snap) if (SOLIDS[key]) addInstance(makeInstance(key, T));
}

function checkpoint() {
  state.undo.push(snapshot());
  if (state.undo.length > 100) state.undo.shift();
}

function changed() {
  clearHover();
  renderPanel();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected: state.selected, scene: snapshot() }));
  } catch {
    // storage unavailable: the scene just won't survive a reload
  }
}

// ------------------------------------------------------------ solid preview card

const previewEl = $('#preview');
const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
previewEl.append(previewRenderer.domElement);
const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
previewCamera.position.set(0, 0, 1.08 / Math.sin(THREE.MathUtils.degToRad(15)));
previewScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const previewSun = new THREE.DirectionalLight(0xffffff, 1.6);
previewSun.position.set(0.6, 1, 0.8);
previewScene.add(previewSun);
const previewMesh = new THREE.Mesh(undefined, solidMat);
previewMesh.add(new THREE.LineSegments(undefined, edgeMat));
previewMesh.rotation.x = 0.4;
previewScene.add(previewMesh);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function showPreview(key) {
  const g = solidGeometry(key);
  previewMesh.geometry = g.mesh;
  previewMesh.children[0].geometry = g.edges;
  previewMesh.scale.setScalar(1 / buildSolid(key).circumradius); // every solid fills the card
}

new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = previewEl;
  previewRenderer.setSize(w, h, false);
  previewCamera.aspect = w / h;
  previewCamera.updateProjectionMatrix();
}).observe(previewEl);

// ------------------------------------------------------------ placement preview

const ghost = new THREE.Mesh(undefined, ghostMat);
const ghostEdges = new THREE.LineSegments(undefined, ghostEdgeMat);
ghost.add(ghostEdges);
ghost.visible = false;
ghost.renderOrder = 1;
scene.add(ghost);

const highlight = new THREE.LineLoop(new THREE.BufferGeometry(), highlightMat);
highlight.renderOrder = 2;
highlight.visible = false;
scene.add(highlight);

const doomed = new THREE.Mesh(undefined, removalMat);
doomed.add(new THREE.LineSegments(undefined, removalEdgeMat));
doomed.renderOrder = 1;
doomed.visible = false;
scene.add(doomed);

function clearHover() {
  state.hover = null;
  state.removal = null;
  ghost.visible = false;
  highlight.visible = false;
  doomed.visible = false;
  renderStatus();
}

// Removal mode (Shift or Alt held): mark the solid under the pointer instead
// of previewing an addition.
function showRemoval(inst) {
  clearHover();
  state.removal = inst;
  const g = solidGeometry(inst.key);
  doomed.geometry = g.mesh;
  doomed.children[0].geometry = g.edges;
  setTransform(doomed, inst.T);
  doomed.visible = true;
  renderStatus();
}

function setHover(inst, fi) {
  const options = snapOptions(state.selected, inst, fi).map((T) => ({
    T,
    blocked: state.index.collides(makeInstance(state.selected, T)),
  }));
  const free = options.findIndex((o) => !o.blocked);
  state.hover = { inst, fi, options, choice: Math.max(free, 0) };
  state.removal = null;
  doomed.visible = false;

  const f = inst.faces[fi];
  const pts = faceVertices(inst, fi).map((p) => new THREE.Vector3(...p).addScaledVector(new THREE.Vector3(...f.normal), 0.004));
  highlight.geometry.setFromPoints(pts);
  highlight.visible = true;
  showGhost();
}

function showGhost() {
  const h = state.hover;
  if (!h || !h.options.length) {
    ghost.visible = false;
    renderStatus();
    return;
  }
  const opt = h.options[h.choice];
  const g = solidGeometry(state.selected);
  ghost.geometry = g.mesh;
  ghostEdges.geometry = g.edges;
  setTransform(ghost, opt.T);
  const bad = opt.blocked && !state.allowOverlap;
  ghostMat.color.set(bad ? cssVar('--blocked') : '#ffffff');
  ghostEdgeMat.color.set(bad ? cssVar('--blocked') : cssVar('--edge'));
  ghost.visible = true;
  renderStatus();
}

function cycleOrientation(step) {
  const h = state.hover;
  if (!h || h.options.length < 2) return;
  h.choice = (h.choice + step + h.options.length) % h.options.length;
  showGhost();
}

// ------------------------------------------------------------ picking

const raycaster = new THREE.Raycaster();
const pointer = { x: 0, y: 0, inside: false, removing: false };

function pick(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(solidsGroup.children, false)[0];
  if (!hit) return null;
  const inst = hit.object.userData.inst;
  return { inst, fi: solidGeometry(inst.key).triFace[hit.faceIndex] };
}

function hoverAt(clientX, clientY, removing = pointer.removing) {
  const p = pick(clientX, clientY);
  if (!p) return clearHover();
  if (removing) {
    if (state.removal !== p.inst) showRemoval(p.inst);
    return;
  }
  const h = state.hover;
  if (h && h.inst === p.inst && h.fi === p.fi) return;
  setHover(p.inst, p.fi);
}

function place() {
  const h = state.hover;
  if (!h || !h.options.length) return;
  const opt = h.options[h.choice];
  if (opt.blocked && !state.allowOverlap) return toast('That spot overlaps another solid. Try another orientation.');
  if (state.instances.length >= MAX_SOLIDS) return toast(`The scene is capped at ${MAX_SOLIDS} solids.`);
  checkpoint();
  addInstance(makeInstance(state.selected, opt.T));
  changed();
  if (pointer.inside) hoverAt(pointer.x, pointer.y);
}

function removeAt(clientX, clientY) {
  const p = pick(clientX, clientY);
  if (!p) return;
  checkpoint();
  removeInstance(p.inst);
  changed();
  if (pointer.inside) hoverAt(pointer.x, pointer.y);
}

function setRemoving(on) {
  if (pointer.removing === on) return;
  pointer.removing = on;
  if (pointer.inside && !down) hoverAt(pointer.x, pointer.y);
}

const canvas = renderer.domElement;
let down = null;
let moveQueued = false;

canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, button: e.button };
});
canvas.addEventListener('pointermove', (e) => {
  Object.assign(pointer, { x: e.clientX, y: e.clientY, inside: true, removing: e.shiftKey || e.altKey });
  if (e.pointerType === 'touch' || e.buttons) return;
  if (moveQueued) return;
  moveQueued = true;
  requestAnimationFrame(() => {
    moveQueued = false;
    hoverAt(pointer.x, pointer.y);
  });
});
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  if (!down) clearHover();
});
canvas.addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
  if (state.instances.length === 0) {
    checkpoint();
    addInstance(makeInstance(state.selected, IDENTITY));
    changed();
    return frame();
  }
  if (e.shiftKey || e.altKey) return removeAt(e.clientX, e.clientY);
  if (e.pointerType === 'touch') {
    // First tap previews, a second tap on the same face places.
    const p = pick(e.clientX, e.clientY);
    const h = state.hover;
    if (p && h && p.inst === h.inst && p.fi === h.fi) return place();
    return p ? setHover(p.inst, p.fi) : clearHover();
  }
  hoverAt(e.clientX, e.clientY, false);
  place();
});

const isRemoveModifier = (e) => e.key === 'Shift' || e.key === 'Alt';
// On release, removal mode stays on only if the other modifier is still held.
window.addEventListener('keyup', (e) => isRemoveModifier(e) && setRemoving(e.key === 'Shift' ? e.altKey : e.shiftKey));
window.addEventListener('blur', () => setRemoving(false));

window.addEventListener('keydown', (e) => {
  if (isRemoveModifier(e)) {
    if (e.key === 'Alt') e.preventDefault(); // keep Alt from focusing the browser menu
    return setRemoving(true);
  }
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'r' || k === ' ') {
    e.preventDefault();
    cycleOrientation(1);
  } else if (k === 'e') {
    cycleOrientation(-1);
  } else if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (k === 'f') {
    frame();
  } else if ((k === 'delete' || k === 'backspace') && pointer.inside) {
    removeAt(pointer.x, pointer.y);
  }
});

// ------------------------------------------------------------ actions

function undo() {
  const snap = state.undo.pop();
  if (!snap) return toast('Nothing to undo.');
  restore(snap);
  changed();
}

function startOver() {
  checkpoint();
  restore([{ key: state.selected, T: IDENTITY }]);
  changed();
  frame();
}

function frame() {
  const box = new THREE.Box3();
  for (const inst of state.instances) {
    const r = inst.radius;
    box.expandByPoint(new THREE.Vector3(...inst.center).addScalar(r));
    box.expandByPoint(new THREE.Vector3(...inst.center).addScalar(-r));
  }
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, Math.max(dist, 3));
}

function runGrow() {
  const sides = new Set([...document.querySelectorAll('#grow-sides input:checked')].map((i) => Number(i.value)));
  if (!sides.size) return toast('Pick at least one face type to grow across.');
  const room = MAX_SOLIDS - state.instances.length;
  if (room <= 0) return toast(`The scene is capped at ${MAX_SOLIDS} solids.`);
  checkpoint();
  const added = grow({
    seeds: [...state.instances],
    index: state.index,
    sides,
    mode: $('#grow-mode').value,
    generations: Number($('#grow-gens').value),
    limit: room,
  });
  // grow() already inserted into the index; add to the scene only.
  for (const inst of added) state.index.remove(inst);
  for (const inst of added) addInstance(inst);
  if (!added.length) {
    state.undo.pop();
    toast('No room to grow: every candidate either overlaps or doesn’t sit flush.');
  } else {
    toast(`Added ${added.length} solid${added.length > 1 ? 's' : ''}.`);
  }
  changed();
  frame();
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ------------------------------------------------------------ panel

const ORDER = Object.keys(SOLIDS);

function solidButton(key) {
  const s = buildSolid(key);
  const label = s.label ?? vertexConfiguration(s).join('.');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'solid';
  btn.id = `solid-${key}`;
  btn.dataset.key = key;
  btn.dataset.search = `${s.name} ${label}`.toLowerCase();
  btn.title = describeFaces(s);
  const swatches = Object.keys(s.faceCounts)
    .map((n) => `<i style="background:var(${FACE_TOKENS[n]})"></i>`)
    .join('');
  btn.innerHTML = `<span class="solid-name">${s.name}</span><span class="solid-meta"><span class="sw">${swatches}</span><code>${label}</code></span>`;
  btn.addEventListener('click', () => select(key));
  btn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && showCard(key));
  btn.addEventListener('pointerleave', () => showCard(state.selected));
  btn.addEventListener('focus', () => showCard(key));
  btn.addEventListener('blur', () => showCard(state.selected));
  return btn;
}

// One collapsible section per family; the Johnson solids are further split
// into Johnson's own groups.
function buildPicker() {
  const root = $('#picker');
  for (const { name, note, collapsed } of FAMILIES) {
    const keys = ORDER.filter((k) => SOLIDS[k].family === name);
    const details = document.createElement('details');
    details.className = 'family';
    details.id = `family-${name.toLowerCase()}`;
    details.open = !collapsed;
    details.innerHTML = `<summary>${name}<span class="family-count">${keys.length}</span></summary>`;
    if (note) details.insertAdjacentHTML('beforeend', `<p class="family-note">${note}</p>`);

    const groups = new Map();
    for (const key of keys) {
      const g = SOLIDS[key].group ?? -1;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(key);
    }
    for (const [g, groupKeys] of groups) {
      const block = document.createElement('div');
      block.className = 'picker';
      if (g >= 0) block.insertAdjacentHTML('beforeend', `<p class="group">${JOHNSON_GROUPS[g]}</p>`);
      for (const key of groupKeys) block.append(solidButton(key));
      details.append(block);
    }
    root.append(details);
  }
  revealSelected();
}

// Make sure the selected solid's section is open.
function revealSelected() {
  const btn = $(`#solid-${state.selected}`);
  if (btn) btn.closest('details').open = true;
}

function applyFilter() {
  const q = $('#solid-filter').value.trim().toLowerCase();
  let total = 0;
  for (const details of document.querySelectorAll('#picker details')) {
    // Remember the open/closed state chosen by hand while a filter is active.
    if (q && details.dataset.wasOpen === undefined) details.dataset.wasOpen = details.open;
    let shown = 0;
    for (const block of details.querySelectorAll('.picker')) {
      let inBlock = 0;
      for (const btn of block.querySelectorAll('.solid')) {
        btn.hidden = q !== '' && !btn.dataset.search.includes(q);
        if (!btn.hidden) inBlock++;
      }
      block.hidden = inBlock === 0;
      shown += inBlock;
    }
    details.hidden = shown === 0;
    if (q) details.open = true;
    else if (details.dataset.wasOpen !== undefined) {
      details.open = details.dataset.wasOpen === 'true';
      delete details.dataset.wasOpen;
    }
    total += shown;
  }
  const empty = $('#filter-empty');
  empty.hidden = total > 0;
  empty.textContent = `No solids match “${$('#solid-filter').value.trim()}”.`;
  if (!q) revealSelected();
}

// The card at the top of the picker shows the selected solid, or whichever
// one the pointer or keyboard focus is on, spinning in its own little view.
function showCard(key) {
  const s = buildSolid(key);
  $('#selected-name').textContent = s.name;
  $('#selected-faces').textContent = (s.label ? `${s.label} · ` : '') + describeFaces(s) + (s.chiral ? ' · chiral' : '');
  $('#selected').toggleAttribute('data-browsing', key !== state.selected);
  showPreview(key);
}

function select(key) {
  state.selected = key;
  const h = state.hover;
  if (h) setHover(h.inst, h.fi);
  renderPanel();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected: key, scene: snapshot() }));
  } catch {
    // ignore
  }
}

function renderPanel() {
  for (const btn of document.querySelectorAll('.solid')) btn.setAttribute('aria-pressed', btn.dataset.key === state.selected);
  showCard(state.selected);
  const s = buildSolid(state.selected);
  $('#start-over').textContent = `Start over with one ${s.name.toLowerCase()}`;

  const count = state.instances.length;
  $('#count').textContent = `${count} solid${count === 1 ? '' : 's'}`;
  $('#undo').disabled = !state.undo.length;

  // Face types available to grow across: those present in the scene.
  const present = new Set();
  for (const key of new Set(state.instances.map((i) => i.key)))
    for (const n of Object.keys(buildSolid(key).faceCounts)) present.add(Number(n));
  const box = $('#grow-sides');
  const prev = new Map([...box.querySelectorAll('input')].map((i) => [Number(i.value), i.checked]));
  box.innerHTML = '';
  for (const n of [...present].sort((a, b) => a - b)) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" id="grow-${n}" value="${n}" ${prev.get(n) ?? true ? 'checked' : ''}><i style="background:var(${FACE_TOKENS[n]})"></i>${polygon(n)}s`;
    box.append(label);
  }
  $('#grow').disabled = !present.size;
  renderStatus();
}

function renderStatus() {
  const h = state.hover;
  const status = $('#status');
  const orient = $('#orient');
  const sel = buildSolid(state.selected);
  orient.hidden = true;
  status.dataset.state = 'idle';

  if (!state.instances.length) {
    status.textContent = `Click anywhere to place a ${sel.name.toLowerCase()}.`;
    return;
  }
  if (state.removal) {
    status.dataset.state = 'blocked';
    status.textContent = `Click to remove this ${state.removal.solid.name.toLowerCase()}.`;
    return;
  }
  if (!h) {
    status.textContent = `Hover a face to preview a ${sel.name.toLowerCase()} there. Click to snap it on, or hold Shift to remove a solid.`;
    return;
  }
  const n = h.inst.faces[h.fi].sides;
  if (!h.options.length) {
    status.dataset.state = 'blocked';
    status.textContent = `A ${sel.name.toLowerCase()} has no ${polygon(n)} faces to match this one.`;
    return;
  }
  const opt = h.options[h.choice];
  status.dataset.state = opt.blocked ? (state.allowOverlap ? 'warn' : 'blocked') : 'ok';
  status.textContent = `${sel.name} on ${polygon(n)}` + (opt.blocked ? ' · overlaps another solid' : ' · fits');
  if (h.options.length > 1) {
    orient.hidden = false;
    $('#orient-label').textContent = `${h.choice + 1} / ${h.options.length}`;
  }
}

buildPicker();
$('#solid-filter').addEventListener('input', applyFilter);
$('#undo').addEventListener('click', undo);
$('#frame').addEventListener('click', frame);
$('#start-over').addEventListener('click', startOver);
$('#grow').addEventListener('click', runGrow);
$('#orient-prev').addEventListener('click', () => cycleOrientation(-1));
$('#orient-next').addEventListener('click', () => cycleOrientation(1));
$('#allow-overlap').addEventListener('change', (e) => {
  state.allowOverlap = e.target.checked;
  showGhost();
});
$('#show-edges').addEventListener('change', (e) => {
  edgeMat.visible = e.target.checked;
});

// ------------------------------------------------------------ boot

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && SOLIDS[saved.selected]) state.selected = saved.selected;
    if (saved && Array.isArray(saved.scene)) return restore(saved.scene);
  } catch {
    // fall through to the sample scene
  }
  // Sample: a truncated icosahedron with neighbours across two hexagons and a pentagon.
  restore([{ key: 'truncatedIcosahedron', T: IDENTITY }]);
  const seed = state.instances[0];
  for (const sides of [6, 6, 5])
    for (let fi = 0; fi < seed.faces.length; fi++) {
      if (seed.faces[fi].sides !== sides) continue;
      const inst = makeInstance(seed.key, snapOptions(seed.key, seed, fi)[0]);
      if (!state.index.collides(inst)) {
        addInstance(inst);
        break;
      }
    }
}

load();
renderPanel();
frame();

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  controls.update();
  renderer.render(scene, camera);
  if (!reducedMotion.matches) previewMesh.rotation.y += dt * 0.5;
  previewRenderer.render(previewScene, previewCamera);
});
