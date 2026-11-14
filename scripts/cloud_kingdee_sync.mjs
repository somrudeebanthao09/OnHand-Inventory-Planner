import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import XLSX from 'xlsx';

const ACCOUNT = process.env.KINGDEE_ACCOUNT || '';
const PASSWORD = process.env.KINGDEE_PASSWORD || '';
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const DOWNLOAD_PATH = path.resolve(process.cwd(), '.cloud_downloads');
fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });

if (!ACCOUNT || !PASSWORD) {
  console.error('Missing KINGDEE_ACCOUNT or KINGDEE_PASSWORD');
  process.exit(1);
}

async function waitForNewFile(beforeSet, regex, minSize = 10000, timeoutMs = 75000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cur = fs.readdirSync(DOWNLOAD_PATH).filter(f => regex.test(f) && !f.endsWith('.crdownload'));
    const added = cur.filter(f => !beforeSet.has(f));
    if (added.length > 0) {
      const full = path.join(DOWNLOAD_PATH, added[0]);
      if (fs.existsSync(full) && fs.statSync(full).size >= minSize) return added[0];
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

const browser = await puppeteer.launch({
  executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : '/usr/bin/chromium',
  headless: 'new',
  defaultViewport: { width: 1366, height: 768 },
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--unsafely-treat-insecure-origin-as-secure=http://8.213.211.251:31101']
});

try {
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_PATH, eventsEnabled: true });

  await page.goto('http://8.213.211.251:31101/ierp/?formId=gxyhome_page', { waitUntil: 'networkidle2', timeout: 45000 });
  const isLogin = page.url().includes('login.html') || await page.evaluate(() => Boolean(document.querySelector('input[type=password], #password')));
  if (isLogin) {
    await page.waitForSelector('#account', { timeout: 10000 }).catch(() => {});
    await page.type('#account', ACCOUNT, { delay: 20 });
    await page.type((await page.$('#password')) ? '#password' : 'input[type=password]', PASSWORD, { delay: 20 });
    const loginBtn = await page.$('button._2R-qnNNR') || (await page.$('button[type=submit]')) || (await page.$('.login-btn'));
    if (loginBtn) await loginBtn.click(); else await page.keyboard.press('Enter');
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      const handled = await page.evaluate(() => {
        const el = document.querySelector('a._39-YuAUu, a.continue-btn') || Array.from(document.querySelectorAll('a, button')).find(a => (a.innerText || '').trim().toLowerCase() === 'continue');
        if (el) { el.click(); return true; }
        return false;
      });
      if (handled) { await new Promise(r => setTimeout(r, 600)); break; }
      if (!page.url().includes('login.html')) break;
    }
  }
  await page.waitForFunction(() => !location.href.includes('login.html'), { timeout: 20000 }).catch(() => {});
  console.log('Cloud Kingdee login ready:', page.url());

  // Export On-Hand Inventory
  await page.mouse.click(18, 24);
  await new Promise(r => setTimeout(r, 1500));
  const ohPos = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('span, div, a')).find(el => (el.innerText || '').trim() === 'On-Hand Inventory' && el.getBoundingClientRect().left > 150 && el.offsetWidth > 0);
    if (t) { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    return null;
  });
  if (ohPos) {
    await page.mouse.click(ohPos.x, ohPos.y);
    await new Promise(r => setTimeout(r, 4000));
    const qPos = await page.evaluate(() => {
      const q = Array.from(document.querySelectorAll('div, button, span')).find(b => b.children.length === 0 && (b.innerText || '').trim() === 'Query' && b.offsetParent);
      if (q) { const r = q.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      return null;
    });
    if (qPos) await page.mouse.click(qPos.x, qPos.y);
    await new Promise(r => setTimeout(r, 12000));
    const beforeOh = new Set(fs.readdirSync(DOWNLOAD_PATH));
    for (let attempt = 0; attempt < 5; attempt++) {
      const expPos = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span, div, button'));
        const exp = spans.find(s => (s.innerText || '').trim() === 'Export' && s.offsetParent);
        if (exp) { const r = exp.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
        return null;
      });
      if (expPos) await page.mouse.click(expPos.x, expPos.y);
      await new Promise(r => setTimeout(r, 1800));
      const busy = await page.evaluate(() => (document.body?.innerText || '').includes('query task in progress'));
      if (!busy) break;
      await new Promise(r => setTimeout(r, 4000));
    }
    const yesPos = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, span, div')).filter(el => el.children.length === 0 && el.offsetParent);
      const yes = links.find(el => /^(yes|ok)$/i.test((el.innerText || '').trim()));
      if (yes) { const r = yes.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      return null;
    });
    if (yesPos) await page.mouse.click(yesPos.x, yesPos.y);
    const ohFile = await waitForNewFile(beforeOh, /^on-hand inventory.*\.xlsx$/i, 100000, 50000);
    console.log('Cloud On-Hand file:', ohFile);
    if (ohFile) {
      const wb = XLSX.readFile(path.join(DOWNLOAD_PATH, ohFile), { cellDates: false, raw: true });
      const table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false });
      const norm = v => String(v ?? '').trim().toLowerCase().replace(/[\s_\-()：:]/g, '');
      const hdrIdx = table.findIndex(r => r.some(c => norm(c) === 'material') && r.some(c => norm(c) === 'materialname'));
      if (hdrIdx >= 0) {
        const hdr = table[hdrIdx].map(norm);
        const idx = names => { for (const n of names) { const i = hdr.indexOf(norm(n)); if (i >= 0) return i; } return -1; };
        const cCode = idx(['Material', 'Material Code']), cName = idx(['Material Name']), cSpec = idx(['Specification', 'Spec']), cWh = idx(['Warehouse']), cBin = idx(['Storage Bin', 'Storage', 'Location']), cSt = idx(['Inventory Status', 'Stock Status']), cUnit = idx(['BUoM', 'Base Unit', 'Unit']), cAvail = idx(['Available Inventory Quantity', 'Base Quantity Available', 'Available Quantity']), cOh = idx(['Inventory Quantity', 'On-Hand Quantity', 'On Hand Quantity']), cRes = idx(['Inventory Quantity Reserved', 'Base Quantity Reserved', 'Reserved']), cLot = idx(['Lot Number', 'Lot']), cOwn = idx(['Owner', 'Owner Name']), cOwnT = idx(['Owner Type']);
        const rows = table.slice(hdrIdx + 1).filter(r => String(r[cCode] ?? '').trim()).map(r => {
          const oh = Number(String(r[cOh] ?? 0).replace(/,/g, '')) || 0;
          const av = Number(String(r[cAvail] ?? 0).replace(/,/g, '')) || 0;
          const res = cRes >= 0 ? (Number(String(r[cRes] ?? 0).replace(/,/g, '')) || 0) : (oh - av);
          const pc = String(r[cCode] ?? '').trim();
          const pn = String(r[cName] ?? '').trim();
          return { partCode: pc, materialCode: pc, partName: pn, materialName: pn, specification: cSpec >= 0 ? String(r[cSpec] ?? '').trim() : '', warehouse: String(r[cWh] ?? '').trim() || 'ไม่ระบุคลัง', storage: cBin >= 0 ? String(r[cBin] ?? '').trim() : '', status: String(r[cSt] ?? '').trim() || 'Available', unit: String(r[cUnit] ?? '').trim() || 'EA', availableQty: av, onHandQty: oh, onHand: oh, reserved: res, department: null, lotNumber: cLot >= 0 ? String(r[cLot] ?? '').trim() : '', owner: cOwn >= 0 ? String(r[cOwn] ?? '').trim() : '', ownerType: cOwnT >= 0 ? String(r[cOwnT] ?? '').trim() : '' };
        });
        if (rows.length > 100) {
          fs.writeFileSync('OnHandSeed.js', `window.ONHAND_SEED = ${JSON.stringify({ snapshotAt: new Date().toISOString(), filename: ohFile, inventory: rows })};\n`, 'utf8');
          console.log('Updated OnHandSeed.js:', rows.length, 'rows');
        }
      }
    }
  }
} finally {
  await browser.close();
}
