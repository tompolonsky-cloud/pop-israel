const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ── global safety net — prevents Railway crash-loop from unhandled errors ──
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  unhandledRejection:', reason);
  // אל תיצא — Railway ידרוש restart מיותר
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  uncaughtException:', err.message);
  // אם הפורט תפוס (EADDRINUSE) — יציאה נקייה כדי ש-Railway יוכל לרסטרט
  if (err.code === 'EADDRINUSE') {
    console.error('❌  Port already in use — exiting cleanly for Railway restart');
    process.exit(1);
  }
  // אחרת — המשך לרוץ (log בלבד)
});

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
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch(e) { console.error('settings write error:', e.message); }
  console.log(`⚙️  הגדרות עודכנו`);
  res.json({ ok: true });
});

// רכזים שהוסרו ידנית — לא יחזרו גם אם הגיליון מכיל אותם
const COORD_BLOCKLIST = new Set([
  'אפרת', 'מיכל-ברעם', 'אורלי-לוי', 'אסנת-אלוס', 'אוסנת', 'מור-אשל',
]);

// רכזים ידניים שמוחלפים/נוספים ללא תלות בגיליון
const COORD_MANUAL = [
  { coordKey: 'אוסנת', coordName: 'אוסנת', city: 'טבעון' },
  { coordKey: 'רחלי',  coordName: 'רחלי',  city: 'אביחיל' },
];

// תאריכי השקה — נשמרים כאן כדי שלא ימחקו בעדכון גיליון
const LAUNCH_DATES = {
  'טל': '1.1.26', 'נעמה': '1.1.26', 'בילי': '1.1.26',
  'Sivan-Cohen-Gvili': '1.1.26', 'אורטל': '1.1.26', 'מורן': '1.1.26',
  'טליה-ישראלי': '1.1.26', 'ורד-בן-בסה': '1.1.26', 'מירי-ליסק': '1.1.26',
  'הודיה-נובחוב': '1.1.26', 'אירן-דיכנו': '1.1.26', 'רוני-שפי': '1.1.26',
  'אמילי-כהן': '1.1.26', 'שקד-נוימן': '1.1.26', 'רביד-אטיא': '1.1.26',
  'אוסנת': '1.1.26', 'מיטל-כהן': '1.1.26', 'מירב-סארמילי': '1.1.26',
  'חנה-פיסינגר': '1.1.26', 'מאיה': '12.4.26', 'אדם-פליישמן': '12.4.26',
  'כנרת-דן-מטפלת-רגשית': '26.4.26', 'מיכה-לויט': '26.4.26',
  "אליזבת'-גולדברג": '26.4.26',
  'ליבי': '3.5.26', 'מור-אשל': '3.5.26',
  'מעיין-בל-אטד': '10.5.26', 'Miryam-Caspi': '10.5.26',
  'רחלי': '1.1.26',
  // מור-אשל הוסרה מהמערכת
};

// ── POST /api/coordinators — refresh.js posts active coordinator list here
app.post('/api/coordinators', (req, res) => {
  const raw = Array.isArray(req.body) ? req.body : null;
  if (!raw) return res.status(400).json({ error: 'invalid' });
  const list = [...raw.filter(c => !COORD_BLOCKLIST.has(c.coordKey)), ...COORD_MANUAL]
    .map(c => LAUNCH_DATES[c.coordKey] ? { ...c, launchDate: LAUNCH_DATES[c.coordKey] } : c);
  coordList = list;
  fs.writeFileSync(COORD_FILE, JSON.stringify(list, null, 2));
  console.log(`📋 רכזים עודכנו — ${list.length} פעילות`);
  res.json({ ok: true, count: list.length });
});

// ══════════════════════════════════════════════
// Meetings (CRM sheet) — /api/meetings
// ══════════════════════════════════════════════
const LEADS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1aAaW7uSFpIv8I0_4Rt9TsNRnegjYHISJQcMmbP_IGPA/export?format=csv';
let meetingsCache = null;
let meetingsCacheTime = 0;
const MEETINGS_TTL = 30 * 60 * 1000; // 30 min

function fetchURL(url, hops = 6) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      res.on('error', err => settle(reject, err)); // חובה — מונע crash על socket destroy
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && hops > 0) {
        res.resume(); // release socket
        return fetchURL(res.headers.location, hops - 1)
          .then(r => settle(resolve, r)).catch(e => settle(reject, e));
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => settle(resolve, data));
    });
    req.on('error', err => settle(reject, err));
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}

function parseMeetingDate(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim().split(/[\s,]+/)[0];
  const p = s.split('/');
  if (p.length !== 3) return null;
  let [d, m, y] = p.map(Number);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}

function parseMeetingsCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const hdr = parseLine(lines[0], ',').map(h => h.replace(/"/g, '').trim());
  const iDate     = hdr.findIndex(h => h.includes('תאריך ושעת'));
  const iHappened = hdr.findIndex(h => h.includes('בוצעה פגישה'));
  const iRes      = hdr.findIndex(h => h.includes('חוות דעת'));
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i], ',');
    if (!c || c.length < 2) continue;
    const happened = iHappened >= 0 ? (c[iHappened] || '').replace(/"/g,'').trim().toUpperCase() : '';
    if (happened !== 'TRUE') continue;
    const dateStr = iDate >= 0 ? (c[iDate] || '').replace(/"/g,'').trim() : '';
    const date = parseMeetingDate(dateStr);
    const name = (c[0] || '').replace(/"/g,'').trim();
    const res  = iRes >= 0 ? (c[iRes] || '').replace(/"/g,'').trim() : '';
    results.push({ name, dateStr, date, resolution: res });
  }
  return results;
}

app.get('/api/meetings', async (req, res) => {
  try {
    const now = Date.now();
    if (!meetingsCache || now - meetingsCacheTime > MEETINGS_TTL) {
      const csv = await fetchURL(LEADS_SHEET_URL);
      meetingsCache = parseMeetingsCSV(csv);
      meetingsCacheTime = now;
      console.log(`📋 פגישות נטענו — ${meetingsCache.length} עם בוצע=TRUE`);
    }
    const period = req.query.period || 'week';
    const today  = new Date();
    let filtered;
    if (period === 'week') {
      const sun = new Date(today); sun.setDate(today.getDate() - today.getDay()); sun.setHours(0,0,0,0);
      const sat = new Date(sun);   sat.setDate(sun.getDate() + 6);                sat.setHours(23,59,59,999);
      filtered = meetingsCache.filter(m => m.date && m.date >= sun && m.date <= sat);
    } else if (period === 'month') {
      filtered = meetingsCache.filter(m => m.date &&
        m.date.getMonth() === today.getMonth() &&
        m.date.getFullYear() === today.getFullYear());
    } else {
      filtered = meetingsCache;
    }
    res.json({ meetings: filtered.map(m => ({name:m.name, dateStr:m.dateStr, resolution:m.resolution})), total: filtered.length });
  } catch(e) {
    console.error('meetings error:', e.message);
    res.status(500).json({ error: e.message, meetings: [], total: 0 });
  }
});

// ── GET /api/leads — meetings that happened but have no resolution yet
// ══════════════════════════════════════════════
let leadsCache = null, leadsCacheTime = 0;

function parseLeadsCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const hdr = parseLine(lines[0], ',').map(h => h.replace(/"/g,'').trim());
  const iDate     = hdr.findIndex(h => h.includes('תאריך ושעת'));
  const iHappened = hdr.findIndex(h => h.includes('בוצעה פגישה'));
  const iRes      = hdr.findIndex(h => h.includes('חוות דעת'));
  const iPhone    = hdr.findIndex(h => /טלפון|phone|נייד/i.test(h));
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i], ',');
    if (!c || c.length < 2) continue;
    const name = (c[0] || '').replace(/"/g,'').trim();
    if (!name) continue;
    const happened = iHappened >= 0 ? (c[iHappened]||'').replace(/"/g,'').trim().toUpperCase() : '';
    if (happened !== 'TRUE') continue;
    const dateStr = iDate >= 0 ? (c[iDate]||'').replace(/"/g,'').trim() : '';
    const date    = parseMeetingDate(dateStr);
    const res     = iRes >= 0 ? (c[iRes]||'').replace(/"/g,'').trim() : '';
    const phone   = iPhone >= 0 ? (c[iPhone]||'').replace(/"/g,'').replace(/[-\s]/g,'').trim() : '';
    results.push({ name, dateStr, date, resolution: res, phone });
  }
  return results;
}

app.get('/api/leads', async (req, res) => {
  try {
    const now = Date.now();
    if (!leadsCache || now - leadsCacheTime > MEETINGS_TTL) {
      const csv = await fetchURL(LEADS_SHEET_URL);
      leadsCache = parseLeadsCSV(csv);
      leadsCacheTime = now;
    }
    const followup = leadsCache.filter(l => !l.resolution || !l.resolution.trim());
    res.json({
      leads: followup.map(l => ({ name: l.name, dateStr: l.dateStr, resolution: l.resolution, phone: l.phone })),
      total: followup.length
    });
  } catch(e) {
    console.error('leads error:', e.message);
    res.status(500).json({ error: e.message, leads: [], total: 0 });
  }
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

// ══════════════════════════════════════════════
// History — /api/history
// ══════════════════════════════════════════════
const HISTORY_DIR = path.join(__dirname, 'data', 'history');
fs.mkdirSync(HISTORY_DIR, { recursive: true });

// רשימת קבצים היסטוריים
app.get('/api/history', (req, res) => {
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => /^orders_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(HISTORY_DIR, f));
        const dateStr = f.replace('orders_', '').replace('.csv', '');
        return { filename: f, date: dateStr, size: stat.size };
      });
    res.json({ files });
  } catch(e) {
    res.json({ files: [] });
  }
});

// הורדת קובץ ספציפי
app.get('/api/history/:filename', (req, res) => {
  const fn = path.basename(req.params.filename);
  if (!/^orders_\d{4}-\d{2}-\d{2}\.csv$/.test(fn)) return res.status(400).json({ error: 'invalid' });
  const fp = path.join(HISTORY_DIR, fn);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
  res.sendFile(fp);
});

// העלאת CSV ידנית (מהאדמין)
app.post('/api/history/upload', (req, res) => {
  const csv = typeof req.body === 'string' ? req.body : null;
  if (!csv || csv.length < 50) return res.status(400).json({ error: 'empty csv' });
  const dateStr = (req.query.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'invalid date — use YYYY-MM-DD' });
  const fp = path.join(HISTORY_DIR, `orders_${dateStr}.csv`);
  fs.writeFileSync(fp, csv);
  console.log(`📁 היסטוריה הועלתה ידנית: orders_${dateStr}.csv (${csv.length} bytes)`);
  res.json({ ok: true, filename: `orders_${dateStr}.csv` });
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
  // match 10-digit Israeli mobile (with or without dashes/spaces)
  const pm = str.match(/0\d{9}|0\d[\-\s]?\d{3}[\-\s]?\d{4}/);
  const cp = pm ? pm[0] : '';
  let city = '', rest = str;
  // handle both "עיר - שם" and "עיר- שם" separators
  const sepM = str.match(/ ?- /);
  const di = sepM ? str.indexOf(sepM[0]) : -1;
  if (di > 0) { city = str.slice(0, di).trim(); rest = str.slice(di + sepM[0].length).trim(); }
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
    return { ...p, coordKey: slugify(p.coordName || p.city || key), deliveryStr: key, orders };
  });
}
