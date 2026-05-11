/**
 * refresh.js — מוריד נתונים מ-mypips ומעדכן את הפורטל
 * מופעל אוטומטית 3 פעמים ביום על ידי Task Scheduler
 */
const { chromium } = require('playwright');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const PROFILE_DIR  = path.join(__dirname, 'data', 'browser-profile');
const MYPIPS_URL   = 'https://mypips.app/popisrael/manager/finalized-orders';
const CLOUD_URL    = 'https://pop-israel-production.up.railway.app/api/update';
const CLOUD_COORD  = 'https://pop-israel-production.up.railway.app/api/coordinators';
const LOCAL_URL    = 'http://localhost:3000/api/update';
const LOCAL_COORD  = 'http://localhost:3000/api/coordinators';
const SHEET_URL    = 'https://docs.google.com/spreadsheets/d/1nZTvoIH4kuRZt6haicg-UWt9D5_ET4d1LaNeAgszzyc/export?format=csv&gid=0';

async function main() {
  const ts = new Date().toLocaleString('he-IL');
  console.log(`\n[${ts}] 🔄 מתחיל רענון נתונים...`);

  if (!fs.existsSync(PROFILE_DIR)) {
    console.error('❌ אין פרופיל שמור — הפעל קודם: node first-login.js');
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    locale: 'he-IL',
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(MYPIPS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    const title = await page.title();
    console.log(`   URL: ${currentUrl}`);
    console.log(`   כותרת: ${title}`);

    // Check if still logged in
    if (currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl === 'https://mypips.app/') {
      console.error('❌ Session פג — הפעל: node first-login.js');
      await context.close();
      process.exit(1);
    }

    // Wait for download button
    const dlBtn = page.locator('button', { hasText: 'הורדה' }).first();
    await dlBtn.waitFor({ timeout: 20000 });

    // Click and capture download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      dlBtn.click(),
    ]);

    const downloadPath = await download.path();
    const csv = fs.readFileSync(downloadPath, 'utf-8');

    if (!csv || csv.length < 50) throw new Error('CSV ריק');

    // שליפת רשימת רכזים מהגיליון — הדפדפן כבר מחובר ל-Google
    let sheetCsv = null;
    try {
      sheetCsv = await page.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        return r.ok ? r.text() : null;
      }, SHEET_URL);
    } catch(e) {}

    await context.close();

    // Send to local + cloud
    await Promise.allSettled([postData(LOCAL_URL, csv, 'text/plain'), postData(CLOUD_URL, csv, 'text/plain')]);

    console.log(`✅ עודכן בהצלחה [${new Date().toLocaleString('he-IL')}]`);
    console.log(`   שורות: ${csv.split('\n').length - 1}`);

    // עדכון רשימת רכזים
    const LOCAL_COORD = path.join(__dirname, 'data', 'coordinators.json');
    try {
      const coords = sheetCsv ? parseSheetCoords(sheetCsv) : JSON.parse(fs.readFileSync(LOCAL_COORD, 'utf-8'));
      if (sheetCsv) fs.writeFileSync(LOCAL_COORD, JSON.stringify(coords, null, 2));
      await Promise.allSettled([postJSON(LOCAL_COORD, coords), postJSON(CLOUD_COORD, coords)]);
      console.log(`   רכזים פעילים: ${coords.length}${sheetCsv ? ' (עודכן מהגיליון)' : ' (מקובץ מקומי)'}`);
    } catch(e) {
      console.warn(`   ⚠️ לא עודכנה רשימת רכזים: ${e.message}`);
    }

  } catch (err) {
    await context.close();
    console.error(`❌ שגיאה: ${err.message}`);
    process.exit(1);
  }
}

function fetchUrl(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        fetchUrl(res.headers.location, redirects - 1).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
  });
}

function parseSheetCoords(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const hdr = parseSheetLine(lines[0]).map(h => h.trim());
  const iName   = hdr.findIndex(h => h.includes('שם הרכז'));
  const iCity   = hdr.findIndex(h => h.includes('עיר'));
  const iStatus = hdr.findIndex(h => h.includes('סטטוס'));
  const iLaunch = hdr.findIndex(h => h.includes('העלאה'));
  if (iName < 0 || iStatus < 0) return [];
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseSheetLine(lines[i]);
    if ((cols[iStatus] || '').trim() !== 'פעילה') continue;
    const name = (cols[iName] || '').trim();
    if (!name) continue;
    result.push({
      coordKey:   slugifyStr(name),
      coordName:  name,
      city:       iCity  >= 0 ? (cols[iCity]   || '').trim().replace(/^"|"$/g, '') : '',
      launchDate: iLaunch >= 0 ? (cols[iLaunch] || '').trim() : '',
    });
  }
  return result;
}

function parseSheetLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function slugifyStr(s) { return (s || '').trim().replace(/\s+/g, '-'); }

function postJSON(urlStr, data) {
  return postData(urlStr, JSON.stringify(data), 'application/json');
}

function postData(urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf-8');
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : require('http');
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': buf.length },
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

main();
