import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('C:/Users/Admin/Downloads/h9-part-readiness-chrome-helper/node_modules/puppeteer-core');
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARTIFACTS_DIR = 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338';

async function run() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('Browser Error:', msg.text());
    });
    page.on('pageerror', err => {
      console.log('Page Error:', err.message);
      errors.push(err.message);
    });

    console.log('Navigating to app...');
    await page.goto('http://127.0.0.1:49371/Index.html', { waitUntil: 'networkidle0', timeout: 15000 });

    if (errors.length) {
      throw new Error('Page had errors on load: ' + errors.join(', '));
    }
    console.log('Page loaded successfully without syntax errors!');

    // 1. Verify manual lock button
    console.log('Testing manual lock button...');
    const manualLockBtn = await page.$('#manualLockBtn');
    if (!manualLockBtn) throw new Error('#manualLockBtn not found!');
    await manualLockBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const isLocked = await page.evaluate(() => {
      const lock = document.getElementById('securityLockScreen');
      return lock && lock.classList.contains('active') && !lock.classList.contains('hidden');
    });
    console.log('Is screen locked:', isLocked);
    if (!isLocked) throw new Error('Lock screen did not activate!');

    // Take screenshot of locked screen
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'verified_lock_screen.png') });
    console.log('Captured verified_lock_screen.png');

    // 2. Test wrong passcode
    console.log('Testing wrong passcode...');
    await page.type('#lockPasscodeInput', '9999');
    await page.click('#lockSubmitBtn');
    await new Promise(r => setTimeout(r, 300));

    const wrongResult = await page.evaluate(() => {
      const errMsg = document.getElementById('lockErrorMsg')?.textContent;
      const isStillLocked = document.getElementById('securityLockScreen')?.classList.contains('active');
      return { errMsg, isStillLocked };
    });
    console.log('Wrong passcode feedback:', wrongResult);
    if (!wrongResult.errMsg.includes('ไม่ถูกต้อง')) throw new Error('Error message not shown for wrong passcode!');

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'verified_lock_error.png') });
    console.log('Captured verified_lock_error.png');

    // 3. Test correct default passcode '1234'
    console.log('Testing correct default passcode 1234...');
    await page.evaluate(() => { document.getElementById('lockPasscodeInput').value = ''; });
    await page.type('#lockPasscodeInput', '1234');
    await page.click('#lockSubmitBtn');
    await new Promise(r => setTimeout(r, 400));

    const isUnlocked = await page.evaluate(() => {
      const lock = document.getElementById('securityLockScreen');
      return lock && !lock.classList.contains('active');
    });
    console.log('Is screen unlocked:', isUnlocked);
    if (!isUnlocked) throw new Error('Failed to unlock with 1234!');

    // 4. Test Settings page security panel
    console.log('Navigating to Settings page...');
    await page.evaluate(() => {
      document.querySelector('button[data-page="settings"]').click();
    });
    await new Promise(r => setTimeout(r, 400));

    const settingsData = await page.evaluate(() => {
      const select = document.getElementById('autoLockTimeoutSelect');
      const badge = document.getElementById('securityStatusBadge');
      return {
        timeoutValue: select ? select.value : null,
        badgeText: badge ? badge.textContent : null
      };
    });
    console.log('Settings panel data:', settingsData);
    if (settingsData.timeoutValue !== '15') throw new Error('Default timeout value should be 15!');

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'verified_security_settings.png') });
    console.log('Captured verified_security_settings.png');

    // 5. Test F5 persistence
    console.log('Testing F5 reload persistence when locked...');
    await page.evaluate(() => { window.appLockScreen('test'); });
    await new Promise(r => setTimeout(r, 300));
    console.log('Reloading page...');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    const lockedAfterReload = await page.evaluate(() => {
      const lock = document.getElementById('securityLockScreen');
      return lock && lock.classList.contains('active') && !lock.classList.contains('hidden');
    });
    console.log('Is still locked after reload:', lockedAfterReload);
    if (!lockedAfterReload) throw new Error('Lock state did not persist after reload!');

    // Unlock after reload
    await page.type('#lockPasscodeInput', '1234');
    await page.click('#lockSubmitBtn');
    await new Promise(r => setTimeout(r, 400));

    const finalUnlocked = await page.evaluate(() => {
      const lock = document.getElementById('securityLockScreen');
      return lock && !lock.classList.contains('active');
    });
    console.log('Final unlocked status:', finalUnlocked);
    if (!finalUnlocked) throw new Error('Could not unlock after reload!');

    console.log('ALL SECURITY AUTO-LOCK TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
