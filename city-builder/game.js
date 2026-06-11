'use strict';

/* =========================================================
   CityScape — a free-form vector city map builder
   Roads are smooth hand-drawn curves; districts are organic
   painted regions that auto-fill with buildings and trees.
   World units ≈ metres.
   ========================================================= */

// ---------- World ----------
const MAP = { x: 0, y: 0, w: 8000, h: 8000 };
const SAVE_KEY = 'cityscape-vector-v1';

// ---------- Styles ----------
const ROAD_STYLES = {
  path:    { w: 4,  casing: 0, color: '#b3a47e', dash: [7, 5], z: 0 },
  street:  { w: 10, casing: 3, color: '#4a4f58', casingColor: '#393d44', z: 1 },
  avenue:  { w: 17, casing: 4, color: '#41454d', casingColor: '#33363c', z: 2,
             lane: { color: 'rgba(255,255,255,0.8)', w: 1.3, dash: [9, 9] } },
  highway: { w: 27, casing: 6, color: '#2d3138', casingColor: '#1d2024', z: 3,
             lane: { color: '#e8b923', w: 1.9, dash: null } }
};
const ROAD_ORDER = ['path', 'street', 'avenue', 'highway'];

const AREA_STYLES = {
  water: { fill: '#3a79c9', edge: '#5e96d8', z: 0 },
  park:  { fill: '#5d9c4c', edge: '#4f8a40', z: 1 },
  res:   { fill: '#90b87a', edge: '#7da767', z: 2 },
  com:   { fill: '#9aa7b5', edge: '#8694a4', z: 2 },
  ind:   { fill: '#a8a193', edge: '#968f81', z: 2 }
};
const AREA_ORDER = ['water', 'park', 'res', 'com', 'ind'];

const RES_PALETTE  = ['#d8b46a', '#c98c5a', '#b9655a', '#9a7e64', '#ddc488', '#a8775f'];
const ROOF_PALETTE = ['#8c4f3f', '#74543e', '#6e4a4a', '#5e514a'];
const COM_PALETTE  = ['#5d83ad', '#48688c', '#6e9cc4', '#3f5d7e'];
const IND_PALETTE  = ['#9b9484', '#8d867a', '#a59d8d'];

const GEN_CFG = {
  res: { spacing: 27, min: 10, max: 17, palette: RES_PALETTE },
  com: { spacing: 38, min: 16, max: 28, palette: COM_PALETTE },
  ind: { spacing: 48, min: 20, max: 36, palette: IND_PALETTE }
};

// ---------- City data ----------
let city = { roads: [], areas: [], labels: [] };
let nextId = 1;

// ---------- Camera ----------
const cam = { x: MAP.w / 2, y: MAP.h / 2, z: 0.25 };
const ZOOM_MIN = 0.04, ZOOM_MAX = 8;

// ---------- UI state ----------
let tool = 'street';
let showDots = true;
let dirty = true;          // main canvas needs redraw
let miniDirty = true;      // minimap content cache needs redraw
let unsaved = false;

let stroke = null;         // points of road/area being drawn (world coords)
let strokeShift = false;
let hoverPt = null;        // world cursor position
let snapPt = null;         // current snap target while drawing roads
let selected = null;       // { kind: 'road'|'area'|'label', elem }
let dragState = null;      // moving / endpoint-dragging / panning / erasing
let spaceHeld = false;

const undoStack = [], redoStack = [];
const UNDO_LIMIT = 100;

// ---------- DOM ----------
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
const $ = id => document.getElementById(id);

// =========================================================
// Geometry helpers
// =========================================================
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function polylineDist(p, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, pointSegDist(p, pts[i - 1], pts[i]));
  return d;
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s / 2);
}

// Ramer–Douglas–Peucker simplification
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, maxI = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegDist(pts[i], a, b);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, maxI + 1), eps);
  const right = rdp(pts.slice(maxI), eps);
  return left.slice(0, -1).concat(right);
}

// one round of Chaikin corner-cutting (closed polygon) — softens districts
function chaikinClosed(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function bboxHit(b, view, pad) {
  return b.x1 + pad >= view.x0 && b.x0 - pad <= view.x1 &&
         b.y1 + pad >= view.y0 && b.y0 - pad <= view.y1;
}

function hash01(seed) {
  let h = (seed * 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// =========================================================
// Coordinate transforms
// =========================================================
function screenToWorld(sx, sy) {
  return { x: cam.x + (sx - canvas.clientWidth / 2) / cam.z,
           y: cam.y + (sy - canvas.clientHeight / 2) / cam.z };
}

function viewBounds() {
  const tl = screenToWorld(0, 0), br = screenToWorld(canvas.clientWidth, canvas.clientHeight);
  return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
}

// =========================================================
// Editing model + undo
// =========================================================
function listOf(kind) {
  return kind === 'road' ? city.roads : kind === 'area' ? city.areas : city.labels;
}

function applyOp(op, reverse) {
  const single = o => {
    const list = listOf(o.kind);
    const adding = reverse ? o.op === 'del' : o.op === 'add';
    if (o.op === 'move') {
      const sign = reverse ? -1 : 1;
      translateElem(o.kind, o.elem, o.dx * sign, o.dy * sign);
    } else if (adding) {
      list.push(o.elem);
    } else {
      const i = list.indexOf(o.elem);
      if (i >= 0) list.splice(i, 1);
    }
  };
  if (op.op === 'batch') op.ops.forEach(single); else single(op);
  if (selected && !listOf(selected.kind).includes(selected.elem)) selected = null;
  afterEdit();
}

function pushOp(op) {
  undoStack.push(op);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function commit(op) { applyOp(op, false); pushOp(op); }

function undo() { const op = undoStack.pop(); if (op) { applyOp(op, true); redoStack.push(op); updateUndoButtons(); } }
function redo() { const op = redoStack.pop(); if (op) { applyOp(op, false); undoStack.push(op); updateUndoButtons(); } }

function updateUndoButtons() {
  $('btnUndo').disabled = undoStack.length === 0;
  $('btnRedo').disabled = redoStack.length === 0;
}

function afterEdit() {
  dirty = true;
  miniDirty = true;
  unsaved = true;
  updateStats();
}

function translateElem(kind, elem, dx, dy) {
  for (const p of elem.pts) { p.x += dx; p.y += dy; }
  if (elem.buildings) for (const b of elem.buildings) { b.x += dx; b.y += dy; }
  if (elem.trees) for (const t of elem.trees) { t.x += dx; t.y += dy; }
  elem.bbox = bboxOf(elem.pts);
}

// =========================================================
// Element creation
// =========================================================
function finishRoad(type, pts) {
  if (pts.length < 2) return;
  const simplified = rdp(pts, 4 / Math.max(cam.z, 0.05));
  if (polylineLength(simplified) < 15) return;
  const road = { id: nextId++, type, pts: simplified, bbox: bboxOf(simplified) };
  commit({ op: 'add', kind: 'road', elem: road });
}

function finishArea(type, pts) {
  if (pts.length < 3) return;
  let poly = rdp(pts, 6 / Math.max(cam.z, 0.05));
  if (poly.length < 3 || polyArea(poly) < 600) return;
  poly = chaikinClosed(poly);
  const area = { id: nextId++, type, pts: poly, bbox: bboxOf(poly) };
  generateContents(area);
  commit({ op: 'add', kind: 'area', elem: area });
}

function addLabel(p) {
  const text = prompt('Label text:', '');
  if (!text || !text.trim()) return;
  const label = { id: nextId++, text: text.trim().slice(0, 40),
                  pts: [{ x: p.x, y: p.y }], size: 64 };
  label.bbox = bboxOf(label.pts);
  commit({ op: 'add', kind: 'label', elem: label });
}

// Fill a district with procedurally placed buildings / trees.
// Buildings keep clear of roads and align to the nearest one.
function generateContents(area) {
  if (area.type === 'park') {
    area.trees = [];
    const b = area.bbox, sp = 23;
    for (let y = b.y0; y <= b.y1; y += sp) {
      for (let x = b.x0; x <= b.x1; x += sp) {
        const s = area.id * 7919 + Math.round(x) * 31 + Math.round(y) * 131;
        if (hash01(s) < 0.45) continue;
        const px = Math.round(x + (hash01(s + 1) - 0.5) * sp);
        const py = Math.round(y + (hash01(s + 2) - 0.5) * sp);
        if (!pointInPoly({ x: px, y: py }, area.pts)) continue;
        area.trees.push({ x: px, y: py,
                          r: Math.round((3.5 + hash01(s + 3) * 4.5) * 10) / 10,
                          v: Math.round(hash01(s + 4) * 100) / 100 });
      }
    }
    return;
  }
  const cfg = GEN_CFG[area.type];
  if (!cfg) return;
  area.buildings = [];
  const b = area.bbox;
  for (let y = b.y0; y <= b.y1; y += cfg.spacing) {
    for (let x = b.x0; x <= b.x1; x += cfg.spacing) {
      const s = area.id * 7919 + Math.round(x) * 31 + Math.round(y) * 131;
      const px = x + (hash01(s) - 0.5) * cfg.spacing * 0.6;
      const py = y + (hash01(s + 1) - 0.5) * cfg.spacing * 0.6;
      const c = { x: px, y: py };
      if (!pointInPoly(c, area.pts)) continue;
      const w = cfg.min + hash01(s + 2) * (cfg.max - cfg.min);
      const h = cfg.min + hash01(s + 3) * (cfg.max - cfg.min);

      // keep clear of roads, align to the nearest one
      let rot = hash01(s + 4) * Math.PI, near = Infinity, blocked = false;
      for (const r of city.roads) {
        const halfW = ROAD_STYLES[r.type].w / 2;
        if (!bboxHit(r.bbox, { x0: c.x, y0: c.y, x1: c.x, y1: c.y }, halfW + cfg.max)) continue;
        for (let i = 1; i < r.pts.length; i++) {
          const d = pointSegDist(c, r.pts[i - 1], r.pts[i]);
          if (d < halfW + Math.max(w, h) * 0.65) { blocked = true; break; }
          if (d < near) {
            near = d;
            const a = r.pts[i - 1], e = r.pts[i];
            rot = Math.atan2(e.y - a.y, e.x - a.x);
          }
        }
        if (blocked) break;
      }
      if (blocked) continue;
      area.buildings.push({
        x: Math.round(px), y: Math.round(py),
        w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10,
        rot: Math.round(rot * 100) / 100,
        c: cfg.palette[Math.floor(hash01(s + 5) * cfg.palette.length)],
        v: Math.round(hash01(s + 6) * 100) / 100
      });
    }
  }
}

// =========================================================
// Hit testing
// =========================================================
function hitTest(p) {
  for (const l of city.labels) {
    if (Math.abs(p.x - l.pts[0].x) < l.size * l.text.length * 0.3 &&
        Math.abs(p.y - l.pts[0].y) < l.size) return { kind: 'label', elem: l };
  }
  for (let zi = ROAD_ORDER.length - 1; zi >= 0; zi--) {
    for (let i = city.roads.length - 1; i >= 0; i--) {
      const r = city.roads[i];
      if (r.type !== ROAD_ORDER[zi]) continue;
      const tol = ROAD_STYLES[r.type].w / 2 + 6 / cam.z;
      if (!bboxHit(r.bbox, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, tol)) continue;
      if (polylineDist(p, r.pts) <= tol) return { kind: 'road', elem: r };
    }
  }
  for (let i = city.areas.length - 1; i >= 0; i--) {
    const a = city.areas[i];
    if (bboxHit(a.bbox, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, 0) &&
        pointInPoly(p, a.pts)) return { kind: 'area', elem: a };
  }
  return null;
}

// snap to road endpoints first, then anywhere along a road
function snapToRoads(p, exclude) {
  const maxD = 18 / cam.z;
  let best = null, bestD = maxD;
  for (const r of city.roads) {
    if (r === exclude) continue;
    for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
      const d = dist(p, e);
      if (d < bestD) { bestD = d; best = { x: e.x, y: e.y }; }
    }
  }
  if (best) return best;
  bestD = maxD;
  for (const r of city.roads) {
    if (r === exclude) continue;
    if (!bboxHit(r.bbox, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, maxD)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      t = clamp(t, 0, 1);
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(p, q);
      if (d < bestD) { bestD = d; best = q; }
    }
  }
  return best;
}

// =========================================================
// Rendering
// =========================================================
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  dirty = true;
}

function tracePath(g, pts, closed) {
  g.beginPath();
  if (pts.length < 3) {
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  } else {
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  if (closed) g.closePath();
}

// draws everything in world coordinates; `view` culls, `detail` scales LOD
function renderScene(g, view, z) {
  const detail = z > 0.35, fine = z > 0.9;

  // areas, in layer order
  for (const type of AREA_ORDER) {
    for (const a of city.areas) {
      if (a.type !== type || !bboxHit(a.bbox, view, 50)) continue;
      const st = AREA_STYLES[a.type];
      tracePath(g, a.pts, true);
      g.fillStyle = st.fill;
      g.fill();
      g.strokeStyle = st.edge;
      g.lineWidth = a.type === 'water' ? 5 : 3;
      g.lineJoin = 'round';
      g.stroke();
    }
  }

  // district contents
  if (detail) {
    for (const a of city.areas) {
      if (!bboxHit(a.bbox, view, 50)) continue;
      if (a.trees) {
        for (const t of a.trees) {
          if (t.x < view.x0 - 20 || t.x > view.x1 + 20 || t.y < view.y0 - 20 || t.y > view.y1 + 20) continue;
          if (!fine) {     // medium zoom: one flat circle, cheap
            g.fillStyle = t.v > 0.5 ? '#2f7a40' : '#357f37';
            g.beginPath(); g.arc(t.x, t.y, t.r, 0, 6.283); g.fill();
            continue;
          }
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.beginPath(); g.arc(t.x + t.r * 0.3, t.y + t.r * 0.3, t.r, 0, 6.283); g.fill();
          g.fillStyle = t.v > 0.5 ? '#2f7a40' : '#357f37';
          g.beginPath(); g.arc(t.x, t.y, t.r, 0, 6.283); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.12)';
          g.beginPath(); g.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45, 0, 6.283); g.fill();
        }
      }
      if (a.buildings) {
        for (const b of a.buildings) {
          if (b.x < view.x0 - 40 || b.x > view.x1 + 40 || b.y < view.y0 - 40 || b.y > view.y1 + 40) continue;
          if (!fine) {     // medium zoom: flat unrotated rect, cheap
            g.fillStyle = b.c;
            g.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
            continue;
          }
          g.save();
          g.translate(b.x, b.y);
          g.rotate(b.rot);
          const sh = a.type === 'com' ? 3.5 : 2;
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(-b.w / 2 + sh, -b.h / 2 + sh, b.w, b.h);
          g.fillStyle = b.c;
          g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
          {
            if (a.type === 'res') {
              g.fillStyle = ROOF_PALETTE[Math.floor(b.v * ROOF_PALETTE.length)];
              g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * 0.45);
            } else if (a.type === 'com') {
              g.fillStyle = 'rgba(255,255,255,0.18)';
              g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * 0.22);
              g.fillStyle = 'rgba(220,235,255,0.5)';
              const n = Math.max(2, Math.floor(b.w / 5));
              for (let k = 0; k < n; k++)
                if (hash01(b.x * 13 + b.y * 7 + k) > 0.3)
                  g.fillRect(-b.w / 2 + (k + 0.25) * (b.w / n), -b.h * 0.1, (b.w / n) * 0.5, b.h * 0.5);
            } else {
              g.strokeStyle = 'rgba(0,0,0,0.18)';
              g.lineWidth = 0.8;
              g.beginPath();
              for (let k = 1; k < 4; k++) {
                g.moveTo(-b.w / 2, -b.h / 2 + (b.h * k) / 4);
                g.lineTo(b.w / 2, -b.h / 2 + (b.h * k) / 4);
              }
              g.stroke();
              g.fillStyle = b.v > 0.5 ? '#c9c2b2' : '#6e6a61';
              g.beginPath(); g.arc(b.w * 0.22, -b.h * 0.18, Math.min(b.w, b.h) * 0.16, 0, 6.283); g.fill();
            }
          }
          g.restore();
        }
      }
    }
  }

  // roads: per class — casings first, then surfaces, so same-class
  // roads merge into seamless junctions
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const type of ROAD_ORDER) {
    const st = ROAD_STYLES[type];
    const vis = city.roads.filter(r => r.type === type && bboxHit(r.bbox, view, st.w + 20));
    if (!vis.length) continue;
    if (st.casing) {
      g.strokeStyle = st.casingColor;
      g.lineWidth = st.w + st.casing * 2;
      for (const r of vis) { tracePath(g, r.pts); g.stroke(); }
    }
    g.strokeStyle = st.color;
    g.lineWidth = st.w;
    if (st.dash) g.setLineDash(st.dash);
    for (const r of vis) { tracePath(g, r.pts); g.stroke(); }
    g.setLineDash([]);
    if (st.lane && detail) {
      g.strokeStyle = st.lane.color;
      g.lineWidth = st.lane.w;
      if (st.lane.dash) g.setLineDash(st.lane.dash);
      for (const r of vis) { tracePath(g, r.pts); g.stroke(); }
      g.setLineDash([]);
    }
  }

  // labels
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of city.labels) {
    if (!bboxHit(l.bbox, view, 600)) continue;
    // keep labels readable: world-sized, but clamped in screen pixels
    const sz = clamp(l.size * z, 11, 44) / z;
    g.font = `600 ${sz}px system-ui, sans-serif`;
    g.lineWidth = sz * 0.18;
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.strokeText(l.text, l.pts[0].x, l.pts[0].y);
    g.fillStyle = '#2a2f38';
    g.fillText(l.text, l.pts[0].x, l.pts[0].y);
  }
}

function render() {
  requestAnimationFrame(render);
  if (!dirty) return;
  dirty = false;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, w, h);

  // world transform
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z,
                   dpr * (w / 2 - cam.x * cam.z), dpr * (h / 2 - cam.y * cam.z));

  // land
  ctx.fillStyle = '#7fae62';
  ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);

  const view = viewBounds();

  // reference dots
  if (showDots && cam.z > 0.12) {
    const sp = cam.z > 0.7 ? 100 : 400;
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    const r = 1.6 / cam.z;
    for (let y = Math.max(0, Math.floor(view.y0 / sp) * sp); y <= Math.min(MAP.h, view.y1); y += sp)
      for (let x = Math.max(0, Math.floor(view.x0 / sp) * sp); x <= Math.min(MAP.w, view.x1); x += sp)
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  renderScene(ctx, view, cam.z);

  // in-progress stroke preview
  if (stroke && stroke.length > 1) {
    const pts = strokeShift && ROAD_STYLES[tool] ? [stroke[0], stroke[stroke.length - 1]] : stroke;
    if (ROAD_STYLES[tool]) {
      const st = ROAD_STYLES[tool];
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = st.w;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      tracePath(ctx, pts);
      ctx.stroke();
    } else if (AREA_STYLES[tool]) {
      tracePath(ctx, pts, true);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2 / cam.z;
      ctx.setLineDash([8 / cam.z, 6 / cam.z]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // snap indicator
  if (snapPt) {
    ctx.strokeStyle = '#8fc1ff';
    ctx.lineWidth = 2 / cam.z;
    ctx.beginPath();
    ctx.arc(snapPt.x, snapPt.y, 9 / cam.z, 0, 6.283);
    ctx.stroke();
  }

  // selection highlight
  if (selected) {
    const e = selected.elem;
    ctx.strokeStyle = 'rgba(77,163,255,0.85)';
    if (selected.kind === 'road') {
      ctx.lineWidth = ROAD_STYLES[e.type].w + 8 / cam.z;
      ctx.globalAlpha = 0.35;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      tracePath(ctx, e.pts);
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 / cam.z, 0, 6.283); ctx.fill();
        ctx.lineWidth = 2 / cam.z;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 / cam.z, 0, 6.283); ctx.stroke();
      }
    } else if (selected.kind === 'area') {
      ctx.lineWidth = 3 / cam.z;
      ctx.setLineDash([10 / cam.z, 6 / cam.z]);
      tracePath(ctx, e.pts, true);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const b = e.bbox;
      ctx.lineWidth = 2 / cam.z;
      ctx.strokeRect(b.x0 - e.size * 2, b.y0 - e.size, e.size * 4, e.size * 2);
    }
  }

  // map border
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3 / cam.z;
  ctx.strokeRect(MAP.x, MAP.y, MAP.w, MAP.h);

  renderMinimap();
}

// ---------- Minimap ----------
const miniBuf = document.createElement('canvas');
miniBuf.width = 160; miniBuf.height = 160;
const miniBufCtx = miniBuf.getContext('2d');

function renderMinimap() {
  const s = mini.width / MAP.w;
  if (miniDirty) {
    miniDirty = false;
    const g = miniBufCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#7fae62';
    g.fillRect(0, 0, mini.width, mini.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    for (const type of AREA_ORDER) {
      for (const a of city.areas) {
        if (a.type !== type) continue;
        tracePath(g, a.pts, true);
        g.fillStyle = AREA_STYLES[a.type].fill;
        g.fill();
      }
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const type of ROAD_ORDER) {
      const st = ROAD_STYLES[type];
      g.strokeStyle = type === 'highway' ? '#e8b923' : type === 'path' ? '#b3a47e' : '#393d44';
      g.lineWidth = Math.max(st.w, 30);
      for (const r of city.roads) {
        if (r.type !== type) continue;
        tracePath(g, r.pts);
        g.stroke();
      }
    }
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(miniBuf, 0, 0);
  const vw = canvas.clientWidth / cam.z * s, vh = canvas.clientHeight / cam.z * s;
  mctx.strokeStyle = '#ffffff';
  mctx.lineWidth = 1;
  mctx.strokeRect(cam.x * s - vw / 2, cam.y * s - vh / 2, vw, vh);
}

// =========================================================
// Stats
// =========================================================
function updateStats() {
  let pop = 0, jobs = 0, roadLen = 0, parks = 0;
  for (const a of city.areas) {
    if (a.type === 'res') pop += (a.buildings ? a.buildings.length : 0) * 9;
    else if (a.type === 'com') jobs += (a.buildings ? a.buildings.length : 0) * 16;
    else if (a.type === 'ind') jobs += (a.buildings ? a.buildings.length : 0) * 12;
    else if (a.type === 'park') parks++;
  }
  for (const r of city.roads) if (r.type !== 'path') roadLen += polylineLength(r.pts);
  $('statPop').textContent = pop.toLocaleString();
  $('statJobs').textContent = jobs.toLocaleString();
  $('statRoads').textContent = (roadLen / 1000).toFixed(1);
  $('statParks').textContent = parks;
}

// =========================================================
// Input
// =========================================================
function setTool(name) {
  tool = name;
  if (name !== 'select') selected = null;
  document.querySelectorAll('.tool').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === name));
  canvas.classList.toggle('panning', name === 'pan');
  dirty = true;
}

function pointerDown(sx, sy, opts) {
  const p = screenToWorld(sx, sy);
  if (opts.pan || spaceHeld || tool === 'pan') {
    dragState = { mode: 'pan', sx, sy, camX: cam.x, camY: cam.y };
    canvas.classList.add('dragging');
    return;
  }
  if (tool === 'select') {
    if (selected && selected.kind === 'road') {
      const e = selected.elem;
      for (const which of [0, 1]) {
        const ep = which ? e.pts[e.pts.length - 1] : e.pts[0];
        if (dist(p, ep) < 12 / cam.z) {
          dragState = { mode: 'endpoint', elem: e, which, before: { x: ep.x, y: ep.y } };
          return;
        }
      }
    }
    const hit = hitTest(p);
    selected = hit;
    dirty = true;
    if (hit) dragState = { mode: 'move', kind: hit.kind, elem: hit.elem, last: p, dx: 0, dy: 0 };
    return;
  }
  if (tool === 'erase') {
    dragState = { mode: 'erase', ops: [] };
    eraseAt(p, dragState.ops);
    return;
  }
  if (tool === 'label') { addLabel(p); return; }

  if (ROAD_STYLES[tool]) {
    const snap = snapToRoads(p);
    stroke = [snap || p];
    snapPt = snap;
  } else if (AREA_STYLES[tool]) {
    stroke = [p];
  }
  dirty = true;
}

function pointerMove(sx, sy) {
  const p = screenToWorld(sx, sy);
  hoverPt = p;
  if (dragState) {
    if (dragState.mode === 'pan') {
      cam.x = dragState.camX - (sx - dragState.sx) / cam.z;
      cam.y = dragState.camY - (sy - dragState.sy) / cam.z;
      clampCamera();
    } else if (dragState.mode === 'move') {
      const dx = p.x - dragState.last.x, dy = p.y - dragState.last.y;
      translateElem(dragState.kind, dragState.elem, dx, dy);
      dragState.dx += dx; dragState.dy += dy;
      dragState.last = p;
      miniDirty = true;
    } else if (dragState.mode === 'endpoint') {
      const e = dragState.elem;
      const snap = snapToRoads(p, e);
      const target = snap || p;
      snapPt = snap;
      const i = dragState.which ? e.pts.length - 1 : 0;
      e.pts[i].x = target.x; e.pts[i].y = target.y;
      e.bbox = bboxOf(e.pts);
      miniDirty = true;
    } else if (dragState.mode === 'erase') {
      eraseAt(p, dragState.ops);
    }
    dirty = true;
    return;
  }
  if (stroke) {
    if (ROAD_STYLES[tool]) {
      snapPt = snapToRoads(p);  // shown as a hint; applied to the endpoint on release
      if (dist(p, stroke[stroke.length - 1]) > 2 / cam.z) stroke.push(p);
    } else if (dist(p, stroke[stroke.length - 1]) > 3 / cam.z) {
      stroke.push(p);
    }
    dirty = true;
  } else if (tool === 'select' || tool === 'erase') {
    dirty = true; // keep hover affordances fresh
  }
}

function pointerUp() {
  if (dragState) {
    if (dragState.mode === 'pan') {
      canvas.classList.remove('dragging');
    } else if (dragState.mode === 'move' && (dragState.dx || dragState.dy)) {
      pushOp({ op: 'move', kind: dragState.kind, elem: dragState.elem,
               dx: dragState.dx, dy: dragState.dy });
      afterEdit();
    } else if (dragState.mode === 'endpoint') {
      const e = dragState.elem;
      const i = dragState.which ? e.pts.length - 1 : 0;
      pushOp({ op: 'move-pt', kind: 'road', elem: e, which: i,
               before: dragState.before, after: { x: e.pts[i].x, y: e.pts[i].y } });
      // move-pt handled via custom replay below
      afterEdit();
    } else if (dragState.mode === 'erase' && dragState.ops.length) {
      pushOp({ op: 'batch', ops: dragState.ops });
      afterEdit();
    }
    dragState = null;
    snapPt = null;
    dirty = true;
    return;
  }
  if (stroke) {
    let pts = strokeShift && ROAD_STYLES[tool] ? [stroke[0], stroke[stroke.length - 1]] : stroke;
    if (ROAD_STYLES[tool]) {
      const snap = snapToRoads(pts[pts.length - 1]);
      if (snap && pts.length > 1) pts = pts.slice(0, -1).concat([snap]);
      finishRoad(tool, pts);
    } else if (AREA_STYLES[tool]) finishArea(tool, pts);
    stroke = null;
    snapPt = null;
    dirty = true;
  }
}

function eraseAt(p, ops) {
  const hit = hitTest(p);
  if (!hit) return;
  const op = { op: 'del', kind: hit.kind, elem: hit.elem };
  applyOp(op, false);
  ops.push(op);
}

// move-pt ops need their own undo/redo replay
const baseApplyOp = applyOp;
applyOp = function (op, reverse) {
  if (op.op === 'move-pt') {
    const src = reverse ? op.before : op.after;
    op.elem.pts[op.which].x = src.x;
    op.elem.pts[op.which].y = src.y;
    op.elem.bbox = bboxOf(op.elem.pts);
    afterEdit();
    return;
  }
  baseApplyOp(op, reverse);
};

function clampCamera() {
  const m = 600 / cam.z;
  cam.x = clamp(cam.x, MAP.x - m, MAP.x + MAP.w + m);
  cam.y = clamp(cam.y, MAP.y - m, MAP.y + MAP.h + m);
}

// ---------- Mouse ----------
canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  strokeShift = e.shiftKey;
  if (e.button === 1 || e.button === 2) {
    pointerDown(e.clientX - rect.left, e.clientY - rect.top, { pan: true });
    e.preventDefault();
  } else if (e.button === 0) {
    pointerDown(e.clientX - rect.left, e.clientY - rect.top, {});
  }
});

window.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  strokeShift = e.shiftKey;
  pointerMove(e.clientX - rect.left, e.clientY - rect.top);
});

window.addEventListener('mouseup', () => pointerUp());
canvas.addEventListener('contextmenu', e => e.preventDefault());

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
  dirty = true;
}, { passive: false });

// ---------- Touch ----------
let pinchPrev = null;

function touchPos(t) {
  const rect = canvas.getBoundingClientRect();
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    stroke = null;
    if (dragState && dragState.mode !== 'pan') pointerUp();
    dragState = null;
    const a = touchPos(e.touches[0]), b = touchPos(e.touches[1]);
    pinchPrev = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  pinchPrev = null;
  const p = touchPos(e.touches[0]);
  pointerDown(p.x, p.y, {});
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (pinchPrev) {
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
    dirty = true;
    return;
  }
  const p = touchPos(e.touches[0]);
  pointerMove(p.x, p.y);
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (e.touches.length > 0) {
    if (pinchPrev) {
      const p = touchPos(e.touches[0]);
      pinchPrev = { d: 0, cx: p.x, cy: p.y };
    }
    return;
  }
  if (pinchPrev) { pinchPrev = null; return; }
  pointerUp();
});

// ---------- Minimap ----------
function miniJump(e) {
  const rect = mini.getBoundingClientRect();
  cam.x = (e.clientX - rect.left) / rect.width * MAP.w;
  cam.y = (e.clientY - rect.top) / rect.height * MAP.h;
  clampCamera();
  dirty = true;
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
// Zoom controls
// =========================================================
function zoomBy(f) {
  cam.z = clamp(cam.z * f, ZOOM_MIN, ZOOM_MAX);
  updateZoomLabel();
  dirty = true;
}

function fitView() {
  cam.x = MAP.x + MAP.w / 2;
  cam.y = MAP.y + MAP.h / 2;
  cam.z = clamp(Math.min(canvas.clientWidth, canvas.clientHeight) / MAP.w * 0.95, ZOOM_MIN, ZOOM_MAX);
  updateZoomLabel();
  dirty = true;
}

function updateZoomLabel() {
  $('zoomLabel').textContent = Math.round(cam.z * 100) + '%';
}

// =========================================================
// Save / load / export
// =========================================================
function saveCity(silent) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      name: $('cityName').value, city, nextId, ts: Date.now()
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
    if (!data.city) return false;
    city = data.city;
    nextId = data.nextId || 1;
    if (data.name) $('cityName').value = data.name;
    for (const list of [city.roads, city.areas, city.labels])
      for (const e of list) e.bbox = bboxOf(e.pts);
    return true;
  } catch (err) {
    return false;
  }
}

function exportPNG() {
  const all = [...city.roads, ...city.areas, ...city.labels];
  let b = all.length
    ? all.reduce((acc, e) => ({
        x0: Math.min(acc.x0, e.bbox.x0), y0: Math.min(acc.y0, e.bbox.y0),
        x1: Math.max(acc.x1, e.bbox.x1), y1: Math.max(acc.y1, e.bbox.y1)
      }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    : { x0: 0, y0: 0, x1: MAP.w, y1: MAP.h };
  const pad = 150;
  b = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const scale = Math.min(2400 / bw, 2400 / bh, 2);

  const out = document.createElement('canvas');
  out.width = Math.round(bw * scale);
  out.height = Math.round(bh * scale) + 44;
  const g = out.getContext('2d');
  g.fillStyle = '#7fae62';
  g.fillRect(0, 0, out.width, out.height);
  g.setTransform(scale, 0, 0, scale, -b.x0 * scale, -b.y0 * scale);
  renderScene(g, b, scale);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, out.height - 44, out.width, 44);
  g.fillStyle = '#fff';
  g.font = '600 20px system-ui, sans-serif';
  g.fillText($('cityName').value || 'My City', 14, out.height - 15);

  const a = document.createElement('a');
  a.download = ($('cityName').value || 'city').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.png';
  a.href = out.toDataURL('image/png');
  a.click();
  toast('Map exported');
}

function clearCity() {
  if (!confirm('Clear the entire map? This cannot be undone.')) return;
  city = { roads: [], areas: [], labels: [] };
  selected = null;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButtons();
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

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnZoomIn').addEventListener('click', () => zoomBy(1.25));
$('btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.25));
$('btnFit').addEventListener('click', fitView);
$('btnGrid').addEventListener('click', () => {
  showDots = !showDots;
  $('btnGrid').classList.toggle('active', showDots);
  dirty = true;
});
$('btnSave').addEventListener('click', () => saveCity(false));
$('btnExport').addEventListener('click', exportPNG);
$('btnClear').addEventListener('click', clearCity);
$('cityName').addEventListener('change', () => { unsaved = true; });
$('hintClose').addEventListener('click', () => $('hint').remove());

const TOOL_KEYS = { 1: 'select', 2: 'highway', 3: 'avenue', 4: 'street', 5: 'path',
                    6: 'res', 7: 'com', 8: 'ind', 9: 'park' };

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { spaceHeld = true; canvas.classList.add('panning'); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault(); e.shiftKey ? redo() : undo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCity(false); return; }
  if (TOOL_KEYS[e.key]) { setTool(TOOL_KEYS[e.key]); return; }
  switch (e.key) {
    case 'w': case 'W': setTool('water'); break;
    case 'l': case 'L': setTool('label'); break;
    case 'e': case 'E': setTool('erase'); break;
    case 'v': case 'V': setTool('select'); break;
    case 'g': case 'G': $('btnGrid').click(); break;
    case '+': case '=': zoomBy(1.25); break;
    case '-': case '_': zoomBy(1 / 1.25); break;
    case '0': fitView(); break;
    case 'Delete': case 'Backspace':
      if (selected) {
        commit({ op: 'del', kind: selected.kind, elem: selected.elem });
        selected = null;
      }
      break;
    case 'Escape':
      stroke = null; snapPt = null; selected = null; dirty = true;
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
setInterval(() => { if (unsaved) saveCity(true); }, 15000);

// =========================================================
// Starter city — a river, a sweeping highway, an avenue loop
// with streets and organic districts
// =========================================================
function seedCity() {
  const addRoad = (type, pts) => {
    const r = { id: nextId++, type, pts, bbox: bboxOf(pts) };
    city.roads.push(r);
    return r;
  };
  const blob = (cx, cy, r, seed, n = 14) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + 0.3 * hash01(seed + i));
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    return chaikinClosed(pts);
  };
  const addArea = (type, pts) => {
    const a = { id: nextId++, type, pts, bbox: bboxOf(pts) };
    generateContents(a);
    city.areas.push(a);
    return a;
  };

  // river crossing the map
  const top = [], bottom = [];
  for (let x = -100; x <= MAP.w + 100; x += 250) {
    const yc = 5300 + Math.sin(x / 1100) * 420 + Math.sin(x / 430) * 130;
    top.push({ x, y: yc - 130 });
    bottom.unshift({ x, y: yc + 130 });
  }
  const river = { id: nextId++, type: 'water', pts: top.concat(bottom) };
  river.bbox = bboxOf(river.pts);
  city.areas.push(river);

  // sweeping highway
  const hwy = [];
  for (let x = -100; x <= MAP.w + 100; x += 300)
    hwy.push({ x, y: 2500 + Math.sin(x / 1400 + 1.2) * 600 });
  addRoad('highway', hwy);

  // avenue ring around downtown
  const C = { x: 3900, y: 3500 };
  const ring = [];
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const rr = 850 * (0.9 + 0.15 * Math.sin(a * 3 + 1));
    ring.push({ x: C.x + Math.cos(a) * rr, y: C.y + Math.sin(a) * rr });
  }
  addRoad('avenue', ring);

  // avenues out of the ring + connector to highway
  addRoad('avenue', [{ x: C.x - 850, y: C.y }, { x: C.x - 1900, y: C.y - 150 }, { x: C.x - 2700, y: C.y - 600 }]);
  addRoad('avenue', [{ x: C.x + 880, y: C.y - 100 }, { x: C.x + 2000, y: C.y - 300 }, { x: C.x + 2900, y: C.y - 200 }]);
  addRoad('avenue', [{ x: C.x, y: C.y - 780 }, { x: C.x + 100, y: C.y - 1500 }, { x: C.x - 50, y: 2520 }]);
  addRoad('avenue', [{ x: C.x, y: C.y + 840 }, { x: C.x - 100, y: C.y + 1500 }, { x: C.x + 60, y: 5180 }]);

  // downtown streets — slightly bent grid inside the ring
  for (let k = -2; k <= 2; k++) {
    const pts = [];
    for (let x = C.x - 700; x <= C.x + 700; x += 175)
      pts.push({ x, y: C.y + k * 280 + Math.sin(x / 500 + k) * 60 });
    addRoad('street', pts);
    const vpts = [];
    for (let y = C.y - 700; y <= C.y + 700; y += 175)
      vpts.push({ x: C.x + k * 280 + Math.sin(y / 460 - k) * 60, y });
    addRoad('street', vpts);
  }

  // riverside path
  const path = [];
  for (let x = 1400; x <= 6800; x += 300)
    path.push({ x, y: 5300 + Math.sin(x / 1100) * 420 + Math.sin(x / 430) * 130 - 220 });
  addRoad('path', path);

  // districts (after roads so buildings can align & keep clear)
  addArea('com', blob(C.x, C.y, 620, 11));
  addArea('res', blob(C.x - 1700, C.y + 300, 700, 22, 16));
  addArea('res', blob(C.x + 1800, C.y - 500, 650, 33, 16));
  addArea('ind', blob(C.x - 1500, 2100, 600, 44));
  addArea('park', blob(C.x + 900, C.y + 1100, 420, 55));
  addArea('park', blob(2400, 4700, 380, 66));

  city.labels.push(
    { id: nextId++, text: 'Downtown', pts: [{ x: C.x, y: C.y - 200 }], size: 90 },
    { id: nextId++, text: 'Riverside', pts: [{ x: 3200, y: 4950 }], size: 70 }
  );
  for (const l of city.labels) l.bbox = bboxOf(l.pts);
}

// =========================================================
// Boot
// =========================================================
resizeCanvas();
if (!loadCity()) seedCity();
setTool('street');
fitView();
updateStats();
updateUndoButtons();
requestAnimationFrame(render);
