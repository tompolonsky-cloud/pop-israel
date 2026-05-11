const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, 'data', 'latest.json');
const COORD_FILE    = path.join(__dirname, 'data', 'coordinators.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

app.use(express.text({ limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'portal')));

// Load saved data on startup
let latestData = null;
if (fs.existsSync(DATA_FILE)) {
  try {
    latestData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`📦 נטענו נתונים מ-${latestData.updatedAt}`);
  } catch(e) {}
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, ''));
}

let coordList = [];
if (fs.existsSync(COORD_FILE)) {
  try { coordList = readJSON(COORD_FILE); } catch(e) {}
}

let settings = { times: {}, drivers: {}, waLinks: {}, week: { num: 1, label: 'שבוע 1', openedAt: null } };
if (fs.existsSync(SETTINGS_FILE)) {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) }; } catch(e) {}
}

// ── GET /api/data — portal reads this on startup
app.get('/api/data', (req, res) => {
  if (fs.existsSync(COORD_FILE)) {
    try { coordList = readJSON(COORD_FILE); } catch(e) {}
  }
  if (!latestData && coordList.length === 0) return res.json({ empty: true });
  res.json({ ...(latestData || { updatedAt: null, coords: [] }), coordinators: coordList });
});

// ── GET /api/settings — portal reads secretary settings
app.get('/api/settings', (req, res) => res.json(settings));

// ── POST /api/settings — secretary page saves settings here
app.post('/api/settings', (req, res) => {
  if (typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'invalid' });
  settings = { ...settings, ...req.body };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  console.log(`⚙️  הגדרות עודכנו`);
  res.json({ ok: true });
});

// רכזים שהוסרו ידנית — לא יחזרו גם אם הגיליון מכיל אותם
const COORD_BLOCKLIST = new Set([
  'אפרת', 'מיכל-ברעם', 'אורלי-לוי', 'אסנת-אלוס', 'אוסנת',
]);

// רכזים ידניים שמוחלפים/נוספים ללא תלות בגיליון
const COORD_MANUAL = [
  { coordKey: 'אוסנת', coordName: 'אוסנת', city: 'טבעון' },
];

// ── POST /api/coordinators — refresh.js posts active coordinator list here
app.post('/api/coordinators', (req, res) => {
  const raw = Array.isArray(req.body) ? req.body : null;
  if (!raw) return res.status(400).json({ error: 'invalid' });
  const list = [...raw.filter(c => !COORD_BLOCKLIST.has(c.coordKey)), ...COORD_MANUAL];
  coordList = list;
  fs.writeFileSync(COORD_FILE, JSON.stringify(list, null, 2));
  console.log(`📋 רכזים עודכנו — ${list.length} פעילות`);
  res.json({ ok: true, count: list.length });
});

// ── POST /api/update — refresh.js posts CSV here
app.post('/api/update', (req, res) => {
  const csv = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const coords = parseCSV(csv);
  if (!coords) return res.status(400).json({ error: 'parse failed' });

  latestData = {
    updatedAt: new Date().toISOString(),
    coords,
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(latestData, null, 2));
  console.log(`✅ עודכן — ${coords.length} רכזים, ${coords.reduce((s,c)=>s+c.orders.length,0)} הזמנות`);
  res.json({ ok: true, coordCount: coords.length });
});

app.listen(PORT, () => {
  console.log(`\n🌿 פופ ישראל — שרת פעיל`);
  console.log(`   פורטל: http://localhost:${PORT}`);
  console.log(`   עדכון אחרון: ${latestData?.updatedAt || 'אין עדיין'}\n`);
});

// ══════════════════════════════════════════════
// CSV Parser (same logic as pop-portal-v5.jsx)
// ══════════════════════════════════════════════
function parseLine(line, d) {
  const r = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === d && !inQ) { r.push(cur); cur = ''; continue; }
    cur += c;
  }
  r.push(cur);
  return r;
}

function findCol(h, opts) {
  for (const o of opts) {
    const i = h.findIndex(x => x.includes(o));
    if (i >= 0) return i;
  }
  return -1;
}

function slugify(s = '') { return s.trim().replace(/\s+/g, '-'); }

function cleanPhone(p) {
  if (!p) return '';
  let s = String(p).replace(/\D/g, '');
  if (s.length === 9 && s[0] === '5') s = '0' + s;
  return s;
}

function parseItems(str) {
  return str.split('\n')
    .map(l => l.replace(/🛈\s*/g, '').trim())
    .filter(l => l)
    .map(l => {
      const m = l.match(/^(\d+)\s+([^-]+)-\s*(.+)$/);
      if (m) return { qty: parseInt(m[1]), unit: m[2].trim(), name: m[3].trim() };
      return { qty: 1, unit: '', name: l };
    });
}

function parseDelivery(str) {
  const pm = str.match(/0\d[\-\s]?\d{3}[\-\s]?\d{4}/);
  const cp = pm ? pm[0] : '';
  let city = '', rest = str;
  const di = str.indexOf(' - ');
  if (di > 0) { city = str.slice(0, di).trim(); rest = str.slice(di + 3).trim(); }
  let cn = rest;
  if (cp) cn = rest.replace(cp, '').trim();
  cn = cn.split(',').pop().trim().replace(/\s+\d.*$/, '').trim();
  return { city, coordName: cn, coordPhone: cp };
}

function splitCSVRows(text) {
  const rows = [];
  let cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQ = !inQ; cur += ch; }
    else if (!inQ && (ch === '\n')) { rows.push(cur); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCSV(text) {
  const lines = splitCSVRows(text).filter(l => l.trim());
  if (lines.length < 2) return null;
  const d = lines[0].includes('\t') ? '\t' : ',';
  const hdr = parseLine(lines[0], d).map(h => h.replace(/^﻿/, '').replace(/"/g,'').trim());

  const iD = findCol(hdr, ['אפשרות אספקה / משלוח', 'אפשרות אספקה', 'משלוח']);
  const iN = findCol(hdr, ['שם לקוח', 'שם', 'name']);
  const iP = findCol(hdr, ['טלפון', 'phone', 'נייד']);
  const iT = findCol(hdr, ['סהכ לתשלום', 'סה"כ לתשלום', 'סה"כ', 'total', 'סכום']);
  const iR = findCol(hdr, ['הזמנה ראשונה']);
  const iI = hdr.findIndex(h => h === 'רשימת פריטים' || (h.includes('רשימת פריטים') && !h.includes('חסרים')));

  if (iD < 0) return null;

  const byD = {};
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i], d);
    const dv = (c[iD] || '').trim();
    if (!dv) continue;
    if (!byD[dv]) byD[dv] = [];
    byD[dv].push({
      name: iN >= 0 ? (c[iN] || '').trim() : '',
      phone: iP >= 0 ? cleanPhone(c[iP]) : '',
      total: iT >= 0 ? parseFloat((c[iT] || '0').replace(/[^\d.]/g, '')) || 0 : 0,
      returning: iR >= 0 ? !(c[iR] || '').trim() : false,
      items: iI >= 0 ? parseItems(c[iI] || '') : [],
    });
  }

  return Object.entries(byD).map(([key, orders]) => {
    const p = parseDelivery(key);
    return { ...p, coordKey: slugify(p.coordName || key), deliveryStr: key, orders };
  });
}
