/**
 * first-login.js — כניסה ראשונה חד-פעמית
 * מפעילים פעם אחת: npm run login
 * מתחברים ל-mypips בדפדפן שנפתח, אז לוחצים Enter
 */
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const PROFILE_DIR = path.join(__dirname, 'data', 'browser-profile');
const MYPIPS_URL  = 'https://mypips.app/popisrael/manager/finalized-orders';

async function main() {
  console.log('\n🔐 כניסה ראשונה ל-mypips');
  console.log('   דפדפן ייפתח — התחבר לחשבון שלך');
  console.log('   אחרי שהדף נטען — חזור לכאן ולחץ Enter\n');

  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || await context.newPage();

  await page.goto(MYPIPS_URL);

  // Wait for user to log in
  await new Promise(resolve => {
    process.stdout.write('⏳ ממתין לכניסה... (לחץ Enter אחרי שנכנסת) ');
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });

  await context.close();

  console.log('\n✅ פרופיל נשמר בהצלחה!');
  console.log('   עכשיו אפשר להפעיל: node refresh.js');
  console.log('   (הרענון ידרוש כניסה מחדש רק אם תצא מהחשבון)\n');
}

main().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
