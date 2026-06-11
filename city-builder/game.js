'use strict';

/* =========================================================
   CityScape — a tile-based city map builder
   ========================================================= */

// ---------- World ----------
const GRID = 200;          // map is GRID x GRID tiles
const TILE = 32;           // world units per tile
const WORLD = GRID * TILE;

const T = { EMPTY: 0, ROAD: 1, HIGHWAY: 2, WATER: 3, PARK: 4, RES: 5, COM: 6, IND: 7 };

const TOOL_TILE = { road: T.ROAD, highway: T.HIGHWAY, water: T.WATER, park: T.PARK,
                    res: T.RES, com: T.COM, ind: T.IND, erase: T.EMPTY };

const LINE_TOOLS = new Set(['road', 'highway']);   // drawn as drag-lines
const SAVE_KEY = 'cityscape-save-v1';

let grid = new Uint8Array(GRID * GRID);

// ---------- Camera ----------
const cam = { x: WORLD / 2, y: WORLD / 2, z: 0.6 };  // world coords at screen centre, zoom
const ZOOM_MIN = 0.08, ZOOM_MAX = 6;

// ---------- State ----------
let tool = 'road';
let brush = 1;
let showGrid = true;

let hoverTile = null;          // {x, y} under cursor
let lineStart = null;          // tile where a road drag started
let previewTiles = null;       // Map<index, type> shown while dragging a line
let painting = false;          // brush-paint drag in progress
let strokeChanges = null;      // Map<index, oldValue> for the current stroke

let panState = null;           // {sx, sy, camX, camY}
let spaceHeld = false;

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 120;

let minimapDirty = true;
let unsaved = false;

// ---------- DOM ----------
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
const $ = id => document.getElementById(id);

// =========================================================
// Helpers
// =========================================================
const idx = (x, y) => y * GRID + x;
const inGrid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// deterministic per-tile randomness for building variety
function hash01(x, y, salt) {
  let h = x * 374761393 + y * 668265263 + (salt || 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function screenToWorld(sx, sy) {
  return { x: cam.x + (sx - canvas.clientWidth / 2) / cam.z,
           y: cam.y + (sy - canvas.clientHeight / 2) / cam.z };
}
function worldToScreen(wx, wy) {
  return { x: (wx - cam.x) * cam.z + canvas.clientWidth / 2,
           y: (wy - cam.y) * cam.z + canvas.clientHeight / 2 };
}
function tileAt(sx, sy) {
  const w = screenToWorld(sx, sy);
  const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
  return inGrid(tx, ty) ? { x: tx, y: ty } : null;
}

function isRoadLike(t) { return t === T.ROAD || t === T.HIGHWAY; }

// =========================================================
// Editing
// =========================================================
function brushCells(cx, cy) {
  const r = Math.floor(brush / 2), cells = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (inGrid(x, y)) cells.push(idx(x, y));
  return cells;
}

// L-shaped path (dominant axis first) — feels natural for streets
function lPath(x0, y0, x1, y1) {
  const cells = [];
  const horizFirst = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const push = (x, y) => { if (inGrid(x, y)) cells.push(idx(x, y)); };
  if (horizFirst) {
    for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) push(x, y0);
    for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) push(x1, y);
  } else {
    for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) push(x0, y);
    for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) push(x, y1);
  }
  push(x1, y1);
  return cells;
}

function beginStroke() { strokeChanges = new Map(); }

function strokeSet(i, type) {
  if (grid[i] === type) return;
  if (!strokeChanges.has(i)) strokeChanges.set(i, grid[i]);
  grid[i] = type;
}

function endStroke() {
  if (strokeChanges && strokeChanges.size) {
    undoStack.push(strokeChanges);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    afterEdit();
  }
  strokeChanges = null;
}

function afterEdit() {
  minimapDirty = true;
  unsaved = true;
  updateStats();
  updateUndoButtons();
}

function undo() {
  const changes = undoStack.pop();
  if (!changes) return;
  const inverse = new Map();
  for (const [i, oldVal] of changes) { inverse.set(i, grid[i]); grid[i] = oldVal; }
  redoStack.push(inverse);
  afterEdit();
}

function redo() {
  const changes = redoStack.pop();
  if (!changes) return;
  const inverse = new Map();
  for (const [i, oldVal] of changes) { inverse.set(i, grid[i]); grid[i] = oldVal; }
  undoStack.push(inverse);
  afterEdit();
}

function updateUndoButtons() {
  $('btnUndo').disabled = undoStack.length === 0;
  $('btnRedo').disabled = redoStack.length === 0;
}

// =========================================================
// Stats
// =========================================================
function updateStats() {
  const counts = new Array(8).fill(0);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  const pop  = counts[T.RES] * 14;
  const jobs = counts[T.COM] * 11 + counts[T.IND] * 8;
  const km   = (counts[T.ROAD] + counts[T.HIGHWAY]) * 0.02;
  $('statPop').textContent   = pop.toLocaleString();
  $('statJobs').textContent  = jobs.toLocaleString();
  $('statRoads').textContent = km.toFixed(1);
  $('statParks').textContent = counts[T.PARK].toLocaleString();
}

// =========================================================
// Rendering
// =========================================================
const COLORS = {
  grass:      '#7fae62',
  grassDark:  '#76a55b',
  road:       '#41454d',
  roadEdge:   '#5c616b',
  hwy:        '#23262d',
  hwyStripe:  '#e8b923',
  water:      '#3a79c9',
  waterDeep:  '#306bb4',
  parkBase:   '#5d9c4c',
  resBase:    '#88b573',
  comBase:    '#7e94ad',
  indBase:    '#a9a08a'
};

const RES_PALETTE = ['#d8b46a', '#c98c5a', '#b9655a', '#9a7e64', '#ddc488', '#a8775f'];
const COM_PALETTE = ['#5d83ad', '#48688c', '#6e9cc4', '#3f5d7e'];
const ROOF_PALETTE = ['#8c4f3f', '#74543e', '#6e4a4a', '#5e514a'];

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function neighborsRoad(x, y) {
  // n, e, s, w connectivity for road-like tiles (roads & highways connect)
  return {
    n: y > 0        && isRoadLike(grid[idx(x, y - 1)]),
    e: x < GRID - 1 && isRoadLike(grid[idx(x + 1, y)]),
    s: y < GRID - 1 && isRoadLike(grid[idx(x, y + 1)]),
    w: x > 0        && isRoadLike(grid[idx(x - 1, y)])
  };
}

function sameType(x, y, t) { return inGrid(x, y) && grid[idx(x, y)] === t; }

function render(time) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const z = cam.z, ts = TILE * z;

  // background (out-of-map void)
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, w, h);

  // visible tile range
  const tl = screenToWorld(0, 0), br = screenToWorld(w, h);
  const x0 = clamp(Math.floor(tl.x / TILE), 0, GRID - 1);
  const y0 = clamp(Math.floor(tl.y / TILE), 0, GRID - 1);
  const x1 = clamp(Math.floor(br.x / TILE), 0, GRID - 1);
  const y1 = clamp(Math.floor(br.y / TILE), 0, GRID - 1);

  // grass base for whole map area
  const o = worldToScreen(0, 0);
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(o.x, o.y, WORLD * z, WORLD * z);

  const detail = ts >= 14;        // draw buildings/trees only when zoomed enough
  const fine = ts >= 30;          // windows, dashes, texture

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = previewTiles && previewTiles.has(idx(tx, ty))
              ? previewTiles.get(idx(tx, ty))
              : grid[idx(tx, ty)];
      if (t === T.EMPTY) {
        // subtle grass checker when zoomed in
        if (fine && (tx + ty) % 2 === 0) {
          const p = worldToScreen(tx * TILE, ty * TILE);
          ctx.fillStyle = COLORS.grassDark;
          ctx.fillRect(p.x, p.y, ts, ts);
        }
        continue;
      }
      drawTile(tx, ty, t, ts, detail, fine, time);
    }
  }

  // preview overlay tint
  if (previewTiles) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const i of previewTiles.keys()) {
      const tx = i % GRID, ty = Math.floor(i / GRID);
      const p = worldToScreen(tx * TILE, ty * TILE);
      ctx.fillRect(p.x, p.y, ts, ts);
    }
  }

  // grid lines
  if (showGrid && ts >= 9) {
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let tx = x0; tx <= x1 + 1; tx++) {
      const p = worldToScreen(tx * TILE, 0);
      ctx.moveTo(p.x, Math.max(p.y, 0));
      ctx.lineTo(p.x, Math.min(worldToScreen(0, WORLD).y, h));
    }
    for (let ty = y0; ty <= y1 + 1; ty++) {
      const p = worldToScreen(0, ty * TILE);
      ctx.moveTo(Math.max(p.x, 0), p.y);
      ctx.lineTo(Math.min(worldToScreen(WORLD, 0).x, w), p.y);
    }
    ctx.stroke();
  }

  // map border
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(o.x, o.y, WORLD * z, WORLD * z);

  // hover highlight (brush footprint)
  if (hoverTile && tool !== 'pan' && !panState) {
    const r = LINE_TOOLS.has(tool) ? 0 : Math.floor(brush / 2);
    const p = worldToScreen((hoverTile.x - r) * TILE, (hoverTile.y - r) * TILE);
    const size = (r * 2 + 1) * ts;
    ctx.strokeStyle = tool === 'erase' ? 'rgba(255,93,93,0.9)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, size, size);
  }

  renderMinimap();
  requestAnimationFrame(render);
}

function drawTile(tx, ty, t, ts, detail, fine, time) {
  const p = worldToScreen(tx * TILE, ty * TILE);
  const x = p.x, y = p.y;

  switch (t) {
    case T.ROAD:
    case T.HIGHWAY: {
      drawRoad(tx, ty, t, x, y, ts, fine);
      break;
    }
    case T.WATER: {
      ctx.fillStyle = COLORS.water;
      ctx.fillRect(x, y, ts, ts);
      if (fine) {
        // gentle animated shimmer
        const ph = (time / 900 + hash01(tx, ty, 7) * 6.28);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        const wy = y + ts * (0.3 + 0.15 * Math.sin(ph));
        ctx.fillRect(x + ts * 0.15, wy, ts * 0.45, Math.max(1, ts * 0.05));
        const wy2 = y + ts * (0.7 + 0.12 * Math.sin(ph + 2));
        ctx.fillRect(x + ts * 0.45, wy2, ts * 0.35, Math.max(1, ts * 0.05));
      } else if (detail && hash01(tx, ty, 7) > 0.6) {
        ctx.fillStyle = COLORS.waterDeep;
        ctx.fillRect(x, y, ts, ts);
      }
      break;
    }
    case T.PARK: {
      ctx.fillStyle = COLORS.parkBase;
      ctx.fillRect(x, y, ts, ts);
      if (detail) {
        const n = 2 + Math.floor(hash01(tx, ty, 3) * 2);
        for (let k = 0; k < n; k++) {
          const ox = (0.2 + 0.6 * hash01(tx, ty, 10 + k)) * ts;
          const oy = (0.2 + 0.6 * hash01(tx, ty, 20 + k)) * ts;
          const r = ts * (0.10 + 0.08 * hash01(tx, ty, 30 + k));
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.beginPath(); ctx.arc(x + ox + r * 0.25, y + oy + r * 0.25, r, 0, 6.283); ctx.fill();
          ctx.fillStyle = k % 2 ? '#2f7a40' : '#357f37';
          ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, 6.283); ctx.fill();
        }
      }
      break;
    }
    case T.RES: drawBuilding(tx, ty, x, y, ts, detail, fine, 'res'); break;
    case T.COM: drawBuilding(tx, ty, x, y, ts, detail, fine, 'com'); break;
    case T.IND: drawBuilding(tx, ty, x, y, ts, detail, fine, 'ind'); break;
  }
}

function drawRoad(tx, ty, t, x, y, ts, fine) {
  const hwy = t === T.HIGHWAY;
  const c = neighborsRoad(tx, ty);
  const cx = x + ts / 2, cy = y + ts / 2;

  ctx.fillStyle = hwy ? COLORS.hwy : COLORS.road;
  ctx.fillRect(x, y, ts, ts);

  if (!fine) return;

  // sidewalk / shoulder edges on sides without a connection
  ctx.fillStyle = hwy ? '#3a3f49' : COLORS.roadEdge;
  const e = Math.max(1, ts * 0.08);
  if (!c.n) ctx.fillRect(x, y, ts, e);
  if (!c.s) ctx.fillRect(x, y + ts - e, ts, e);
  if (!c.w) ctx.fillRect(x, y, e, ts);
  if (!c.e) ctx.fillRect(x + ts - e, y, e, ts);

  // centre markings out to each connected edge
  const dirs = [];
  if (c.n) dirs.push([0, -1]);
  if (c.s) dirs.push([0, 1]);
  if (c.w) dirs.push([-1, 0]);
  if (c.e) dirs.push([1, 0]);
  if (!dirs.length) return;       // isolated stub: plain asphalt

  const isXing = dirs.length > 2; // intersections: no markings through middle
  ctx.lineCap = 'butt';
  for (const [dx, dy] of dirs) {
    const ex = cx + dx * ts / 2, ey = cy + dy * ts / 2;
    if (hwy) {
      ctx.strokeStyle = COLORS.hwyStripe;
      ctx.lineWidth = Math.max(1, ts * 0.045);
      const off = ts * 0.07;
      ctx.beginPath();
      // double yellow line
      ctx.moveTo(cx + dy * off, cy + dx * off); ctx.lineTo(ex + dy * off, ey + dx * off);
      ctx.moveTo(cx - dy * off, cy - dx * off); ctx.lineTo(ex - dy * off, ey - dx * off);
      ctx.stroke();
    } else if (!isXing) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1, ts * 0.05);
      ctx.setLineDash([ts * 0.18, ts * 0.16]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawBuilding(tx, ty, x, y, ts, detail, fine, kind) {
  const base = kind === 'res' ? COLORS.resBase : kind === 'com' ? COLORS.comBase : COLORS.indBase;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, ts, ts);
  if (!detail) return;

  const h1 = hash01(tx, ty, 1), h2 = hash01(tx, ty, 2), h3 = hash01(tx, ty, 4);
  const inset = ts * (0.12 + 0.06 * h1);
  const bx = x + inset, by = y + inset;
  const bw = ts - inset * 2, bh = ts - inset * 2;

  // drop shadow for a hint of height
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  const sh = ts * (kind === 'com' ? 0.12 : 0.07);
  ctx.fillRect(bx + sh, by + sh, bw, bh);

  if (kind === 'res') {
    ctx.fillStyle = RES_PALETTE[Math.floor(h2 * RES_PALETTE.length)];
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ROOF_PALETTE[Math.floor(h3 * ROOF_PALETTE.length)];
    ctx.fillRect(bx, by, bw, bh * 0.45);
    if (fine) {  // little garden strip
      ctx.fillStyle = '#69a558';
      ctx.fillRect(x + ts * 0.05, y + ts * 0.8, ts * 0.9, ts * 0.14);
    }
  } else if (kind === 'com') {
    ctx.fillStyle = COM_PALETTE[Math.floor(h2 * COM_PALETTE.length)];
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(bx, by, bw, bh * 0.18);  // rooftop highlight
    if (fine) {
      // window grid
      ctx.fillStyle = 'rgba(220,235,255,0.55)';
      const cols = 3, rows = 3;
      const gw = bw / (cols * 2), gh = bh / (rows * 2);
      for (let r = 0; r < rows; r++)
        for (let cc = 0; cc < cols; cc++)
          if (hash01(tx, ty, 50 + r * 3 + cc) > 0.25)
            ctx.fillRect(bx + gw * (cc * 2 + 0.5), by + gh * (r * 2 + 0.7), gw, gh);
    }
  } else { // industrial
    ctx.fillStyle = h2 > 0.5 ? '#9b9484' : '#8d867a';
    ctx.fillRect(bx, by, bw, bh);
    if (fine) {
      // corrugated roof stripes + a tank or chimney
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        ctx.moveTo(bx, by + (bh * k) / 4);
        ctx.lineTo(bx + bw, by + (bh * k) / 4);
      }
      ctx.stroke();
      ctx.fillStyle = h3 > 0.5 ? '#c9c2b2' : '#6e6a61';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.75, by + bh * 0.3, ts * 0.10, 0, 6.283);
      ctx.fill();
    }
  }
}

// ---------- Minimap ----------
const MINI_COLORS = ['#7fae62', '#9aa0aa', '#e8b923', '#3a79c9', '#2f8f4e', '#62b35c', '#4d8fd1', '#c2a14d'];
const miniBuf = document.createElement('canvas');
miniBuf.width = GRID; miniBuf.height = GRID;
const miniBufCtx = miniBuf.getContext('2d');

function renderMinimap() {
  if (minimapDirty) {
    const img = miniBufCtx.createImageData(GRID, GRID);
    const d = img.data;
    for (let i = 0; i < grid.length; i++) {
      const c = MINI_COLORS[grid[i]];
      d[i * 4]     = parseInt(c.slice(1, 3), 16);
      d[i * 4 + 1] = parseInt(c.slice(3, 5), 16);
      d[i * 4 + 2] = parseInt(c.slice(5, 7), 16);
      d[i * 4 + 3] = 255;
    }
    miniBufCtx.putImageData(img, 0, 0);
    minimapDirty = false;
  }
  mctx.imageSmoothingEnabled = false;
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(miniBuf, 0, 0, mini.width, mini.height);

  // viewport rectangle
  const s = mini.width / WORLD;
  const vw = canvas.clientWidth / cam.z * s;
  const vh = canvas.clientHeight / cam.z * s;
  mctx.strokeStyle = '#ffffff';
  mctx.lineWidth = 1;
  mctx.strokeRect(cam.x * s - vw / 2, cam.y * s - vh / 2, vw, vh);
}

// =========================================================
// Input — mouse
// =========================================================
function setTool(name) {
  tool = name;
  document.querySelectorAll('.tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === name));
  canvas.classList.toggle('panning', name === 'pan');
}

function startPan(e) {
  panState = { sx: e.clientX, sy: e.clientY, camX: cam.x, camY: cam.y };
  canvas.classList.add('dragging');
}

function applyTool(tile) {
  for (const i of brushCells(tile.x, tile.y)) strokeSet(i, TOOL_TILE[tool]);
}

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

  if (e.button === 1 || e.button === 2 || spaceHeld || tool === 'pan') {
    startPan(e);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  const tile = tileAt(sx, sy);
  if (!tile) return;

  if (LINE_TOOLS.has(tool)) {
    lineStart = tile;
    previewTiles = new Map([[idx(tile.x, tile.y), TOOL_TILE[tool]]]);
  } else {
    painting = true;
    beginStroke();
    applyTool(tile);
  }
});

window.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

  if (panState) {
    cam.x = panState.camX - (e.clientX - panState.sx) / cam.z;
    cam.y = panState.camY - (e.clientY - panState.sy) / cam.z;
    clampCamera();
    return;
  }

  hoverTile = tileAt(sx, sy);

  if (lineStart && hoverTile) {
    previewTiles = new Map();
    for (const i of lPath(lineStart.x, lineStart.y, hoverTile.x, hoverTile.y))
      previewTiles.set(i, TOOL_TILE[tool]);
  } else if (painting && hoverTile) {
    applyTool(hoverTile);
  }
});

window.addEventListener('mouseup', e => {
  if (panState) {
    panState = null;
    canvas.classList.remove('dragging');
    return;
  }
  if (lineStart) {
    beginStroke();
    if (previewTiles) for (const [i, t] of previewTiles) strokeSet(i, t);
    endStroke();
    lineStart = null;
    previewTiles = null;
  }
  if (painting) {
    painting = false;
    endStroke();
  }
});

canvas.addEventListener('mouseleave', () => { hoverTile = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// zoom on wheel, anchored at the cursor
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const before = screenToWorld(sx, sy);
  const factor = e.deltaY < 0 ? 1.13 : 1 / 1.13;
  cam.z = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
  const after = screenToWorld(sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  clampCamera();
  updateZoomLabel();
}, { passive: false });

function clampCamera() {
  const margin = 40 / cam.z;
  cam.x = clamp(cam.x, -margin, WORLD + margin);
  cam.y = clamp(cam.y, -margin, WORLD + margin);
}

function zoomBy(factor) {
  cam.z = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
  updateZoomLabel();
}

function fitView() {
  cam.x = WORLD / 2;
  cam.y = WORLD / 2;
  cam.z = Math.min(canvas.clientWidth, canvas.clientHeight) / WORLD * 0.95;
  cam.z = clamp(cam.z, ZOOM_MIN, ZOOM_MAX);
  updateZoomLabel();
}

function updateZoomLabel() {
  $('zoomLabel').textContent = Math.round(cam.z * 100) + '%';
}

// =========================================================
// Input — touch (1 finger draw/pan, 2 fingers pinch-zoom + pan)
// =========================================================
let touchMode = null; // 'draw' | 'pinch'
let pinchPrev = null;

function touchPos(t) {
  const rect = canvas.getBoundingClientRect();
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    // abandon any in-progress draw and start pinching
    if (touchMode === 'draw') { lineStart = null; previewTiles = null;
      if (painting) { painting = false; endStroke(); } }
    touchMode = 'pinch';
    const a = touchPos(e.touches[0]), b = touchPos(e.touches[1]);
    pinchPrev = { d: Math.hypot(a.x - b.x, a.y - b.y),
                  cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  const p = touchPos(e.touches[0]);
  if (tool === 'pan') {
    touchMode = 'pinch'; // single-finger pan uses the same path
    pinchPrev = { d: 0, cx: p.x, cy: p.y };
    return;
  }
  touchMode = 'draw';
  const tile = tileAt(p.x, p.y);
  if (!tile) return;
  if (LINE_TOOLS.has(tool)) {
    lineStart = tile;
    previewTiles = new Map([[idx(tile.x, tile.y), TOOL_TILE[tool]]]);
  } else {
    painting = true;
    beginStroke();
    applyTool(tile);
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (touchMode === 'pinch' && pinchPrev) {
    let cx, cy, d = 0;
    if (e.touches.length >= 2) {
      const a = touchPos(e.touches[0]), b = touchPos(e.touches[1]);
      d = Math.hypot(a.x - b.x, a.y - b.y);
      cx = (a.x + b.x) / 2; cy = (a.y + b.y) / 2;
      if (pinchPrev.d > 0 && d > 0) {
        const before = screenToWorld(cx, cy);
        cam.z = clamp(cam.z * (d / pinchPrev.d), ZOOM_MIN, ZOOM_MAX);
        const after = screenToWorld(cx, cy);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        updateZoomLabel();
      }
    } else {
      const p = touchPos(e.touches[0]);
      cx = p.x; cy = p.y;
    }
    cam.x -= (cx - pinchPrev.cx) / cam.z;
    cam.y -= (cy - pinchPrev.cy) / cam.z;
    clampCamera();
    pinchPrev = { d, cx, cy };
    return;
  }
  if (touchMode === 'draw') {
    const p = touchPos(e.touches[0]);
    const tile = tileAt(p.x, p.y);
    if (!tile) return;
    if (lineStart) {
      previewTiles = new Map();
      for (const i of lPath(lineStart.x, lineStart.y, tile.x, tile.y))
        previewTiles.set(i, TOOL_TILE[tool]);
    } else if (painting) {
      applyTool(tile);
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (e.touches.length > 0) {
    if (touchMode === 'pinch') {
      const p = touchPos(e.touches[0]);
      pinchPrev = { d: 0, cx: p.x, cy: p.y };
    }
    return;
  }
  if (lineStart) {
    beginStroke();
    if (previewTiles) for (const [i, t] of previewTiles) strokeSet(i, t);
    endStroke();
    lineStart = null;
    previewTiles = null;
  }
  if (painting) { painting = false; endStroke(); }
  touchMode = null;
  pinchPrev = null;
});

// =========================================================
// Minimap navigation
// =========================================================
function miniJump(e) {
  const rect = mini.getBoundingClientRect();
  cam.x = (e.clientX - rect.left) / rect.width * WORLD;
  cam.y = (e.clientY - rect.top) / rect.height * WORLD;
  clampCamera();
}
mini.addEventListener('mousedown', e => {
  miniJump(e);
  const move = ev => miniJump(ev);
  const up = () => { window.removeEventListener('mousemove', move);
                     window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// =========================================================
// Save / load / export
// =========================================================
function gridToBase64() {
  let bin = '';
  for (let i = 0; i < grid.length; i += 4096)
    bin += String.fromCharCode.apply(null, grid.subarray(i, i + 4096));
  return btoa(bin);
}

function base64ToGrid(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < Math.min(bin.length, out.length); i++)
    out[i] = bin.charCodeAt(i) & 7;
  return out;
}

function saveCity(silent) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      name: $('cityName').value,
      grid: gridToBase64(),
      ts: Date.now()
    }));
    unsaved = false;
    if (!silent) toast('City saved ✓');
  } catch (err) {
    if (!silent) toast('Could not save (storage unavailable)');
  }
}

function loadCity() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.name) $('cityName').value = data.name;
    if (data.grid) grid = base64ToGrid(data.grid);
    return true;
  } catch (err) {
    return false;
  }
}

function exportPNG() {
  const scale = 6; // px per tile
  const out = document.createElement('canvas');
  out.width = GRID * scale;
  out.height = GRID * scale;
  const octx = out.getContext('2d');
  octx.fillStyle = COLORS.grass;
  octx.fillRect(0, 0, out.width, out.height);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const t = grid[idx(x, y)];
      if (t === T.EMPTY) continue;
      octx.fillStyle = MINI_COLORS[t];
      octx.fillRect(x * scale, y * scale, scale, scale);
      if (t === T.HIGHWAY) {       // make highways read as dark with a stripe
        octx.fillStyle = COLORS.hwy;
        octx.fillRect(x * scale, y * scale, scale, scale);
        octx.fillStyle = COLORS.hwyStripe;
        octx.fillRect(x * scale, y * scale + scale * 0.4, scale, scale * 0.2);
      }
    }
  }
  // title stamp
  octx.fillStyle = 'rgba(0,0,0,0.55)';
  octx.fillRect(0, out.height - 34, out.width, 34);
  octx.fillStyle = '#fff';
  octx.font = '600 18px system-ui, sans-serif';
  octx.fillText($('cityName').value || 'My City', 12, out.height - 11);

  const a = document.createElement('a');
  a.download = ($('cityName').value || 'city').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.png';
  a.href = out.toDataURL('image/png');
  a.click();
  toast('Map exported');
}

function clearCity() {
  if (!confirm('Clear the entire map? This cannot be undone.')) return;
  grid = new Uint8Array(GRID * GRID);
  undoStack.length = 0;
  redoStack.length = 0;
  afterEdit();
  toast('Map cleared');
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// =========================================================
// UI wiring
// =========================================================
document.querySelectorAll('.tool').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

document.querySelectorAll('.brush').forEach(b =>
  b.addEventListener('click', () => {
    brush = parseInt(b.dataset.size, 10);
    document.querySelectorAll('.brush').forEach(x =>
      x.classList.toggle('active', x === b));
  }));

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnZoomIn').addEventListener('click', () => zoomBy(1.25));
$('btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.25));
$('btnFit').addEventListener('click', fitView);
$('btnGrid').addEventListener('click', () => {
  showGrid = !showGrid;
  $('btnGrid').classList.toggle('active', showGrid);
});
$('btnSave').addEventListener('click', () => saveCity(false));
$('btnExport').addEventListener('click', exportPNG);
$('btnClear').addEventListener('click', clearCity);
$('cityName').addEventListener('change', () => { unsaved = true; });
$('hintClose').addEventListener('click', () => $('hint').remove());

const TOOL_KEYS = ['pan', 'road', 'highway', 'res', 'com', 'ind', 'park', 'water', 'erase'];

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { spaceHeld = true; canvas.classList.add('panning'); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCity(false); return; }
  if (e.key >= '1' && e.key <= '9') { setTool(TOOL_KEYS[+e.key - 1]); return; }
  switch (e.key) {
    case 'g': case 'G': $('btnGrid').click(); break;
    case '+': case '=': zoomBy(1.25); break;
    case '-': case '_': zoomBy(1 / 1.25); break;
    case '0': fitView(); break;
    case 'Escape':
      lineStart = null; previewTiles = null;
      if (painting) { painting = false; endStroke(); }
      break;
  }
});

window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceHeld = false;
    if (tool !== 'pan') canvas.classList.remove('panning');
  }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', () => { if (unsaved) saveCity(true); });
setInterval(() => { if (unsaved) saveCity(true); }, 15000);  // autosave

// =========================================================
// A small starter town so the canvas isn't empty
// =========================================================
function seedStarterTown() {
  const c = Math.floor(GRID / 2);
  const set = (x, y, t) => { if (inGrid(x, y)) grid[idx(x, y)] = t; };

  // highway across the map
  for (let x = 0; x < GRID; x++) set(x, c - 14, T.HIGHWAY);

  // main avenue + cross streets
  for (let y = c - 14; y <= c + 16; y++) set(c, y, T.ROAD);
  for (const dy of [-6, 0, 8, 16]) {
    for (let x = c - 12; x <= c + 12; x++) set(x, c + dy, T.ROAD);
  }
  for (const dx of [-12, -6, 6, 12]) {
    for (let y = c - 6; y <= c + 16; y++) set(c + dx, y, T.ROAD);
  }

  // zones in the blocks
  const fillBlock = (x0, y0, x1, y1, t) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (inGrid(x, y) && grid[idx(x, y)] === T.EMPTY) set(x, y, t);
  };
  fillBlock(c - 11, c - 5, c - 7, c - 1, T.COM);
  fillBlock(c - 5,  c - 5, c - 1, c - 1, T.COM);
  fillBlock(c + 1,  c - 5, c + 5, c - 1, T.RES);
  fillBlock(c + 7,  c - 5, c + 11, c - 1, T.RES);
  fillBlock(c - 11, c + 1, c - 7, c + 7, T.RES);
  fillBlock(c - 5,  c + 1, c - 1, c + 7, T.PARK);
  fillBlock(c + 1,  c + 1, c + 5, c + 7, T.RES);
  fillBlock(c + 7,  c + 1, c + 11, c + 7, T.IND);

  // a river along the east side
  for (let y = 0; y < GRID; y++) {
    const bend = Math.round(Math.sin(y / 17) * 3);
    for (let w = 0; w < 4; w++) set(c + 26 + bend + w, y, T.WATER);
  }
}

// =========================================================
// Boot
// =========================================================
resizeCanvas();
if (!loadCity()) seedStarterTown();
setTool('road');
fitView();
updateStats();
updateUndoButtons();
requestAnimationFrame(render);
