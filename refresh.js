/**
 * refresh.js — מוריד נתונים מ-mypips ומעדכן את הפורטל
 * מופעל אוטומטית 3 פעמים ביום על ידי Task Scheduler
 */
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const http = require('http');

const PROFILE_DIR = path.join(__dirname, 'data', 'browser-profile');
const MYPIPS_URL  = 'https://mypips.app/popisrael/manager/finalized-orders';
const SERVER_PORT = 3000;

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

  } catch (err) {
    await context.close();
    console.error(`❌ שגיאה: ${err.message}`);
    process.exit(1);
  }
}

function postCSV(csv) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(csv, 'utf-8');
    const req = http.request({
      hostname: 'localhost',
      port: SERVER_PORT,
      path: '/api/update',
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
