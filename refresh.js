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

    await context.close();

    // Send to local server
    await postCSV(csv);

    console.log(`✅ עודכן בהצלחה [${new Date().toLocaleString('he-IL')}]`);
    console.log(`   שורות: ${csv.split('\n').length - 1}`);

    // גם מעדכן רשימת רכזים מהגיליון
    try {
      const sheetCsv = await fetchUrl(SHEET_URL);
      const coords = parseSheetCoords(sheetCsv);
      await postJSON(CLOUD_COORD, coords);
      console.log(`   רכזים פעילים: ${coords.length}`);
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
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseSheetLine(lines[i]);
    const status = (cols[10] || '').trim();
    if (status !== 'פעילה') continue;
    const name = (cols[1] || '').trim();
    if (!name) continue;
    result.push({
      coordKey:  slugifyStr(name),
      coordName: name,
      city:      (cols[6] || '').trim().replace(/^"|"$/g, ''),
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

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(data), 'utf-8');
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function postCSV(csv) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(csv, 'utf-8');
    const url = new URL(CLOUD_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': buf.length,
      },
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const json = JSON.parse(body);
        console.log(`   רכזים: ${json.coordCount}`);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

main();
