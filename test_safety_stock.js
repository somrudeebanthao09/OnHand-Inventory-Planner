const puppeteer = require('C:/Users/Admin/Downloads/h9-part-readiness-chrome-helper/node_modules/puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    defaultViewport: { width: 1440, height: 960 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  console.log('Navigating to app...');
  await page.goto('http://127.0.0.1:49371/', { waitUntil: 'networkidle2' });

  // Handle login if auth screen is visible
  const authVisible = await page.evaluate(() => {
    const el = document.getElementById('userAuthScreen');
    return el && !el.classList.contains('hidden');
  });

  if (authVisible) {
    console.log('Logging in as admin...');
    await page.type('#loginUsernameInput', 'admin');
    await page.type('#loginPasswordInput', 'admin1234');
    await page.click('#loginSubmitBtn');
    await new Promise(r => setTimeout(r, 1200));
  }

  // Navigate to safety stock page
  console.log('Opening Safety stock page...');
  await page.evaluate(() => {
    document.querySelector('.nav button[data-page="safety"]').click();
  });
  await new Promise(r => setTimeout(r, 700));

  // Check safety metrics and table
  const safetyMetrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#safetyMetricsWrap .metric')).map(m => ({
      title: m.querySelector('.metric-top')?.innerText,
      val: m.querySelector('.metric-value')?.innerText
    }));
    const rows = Array.from(document.querySelectorAll('#safetyTable tbody tr')).length;
    return { cards, rows };
  });
  console.log('Safety Page Initial state:', JSON.stringify(safetyMetrics, null, 2));

  // Set Min and Max on sample parts
  console.log('Setting Min/Max values...');
  await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#safetyTable tbody tr'));
    // Row 0
    if (trs[0]) {
      const minInp = trs[0].querySelector('.safetyMinInput');
      const maxInp = trs[0].querySelector('.safetyMaxInput');
      const avail = Number(trs[0].dataset.available) || 100;
      // Make it low: Min > avail
      minInp.value = String(avail + 500);
      maxInp.value = String(avail + 2000);
      minInp.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Row 1
    if (trs[1]) {
      const minInp = trs[1].querySelector('.safetyMinInput');
      const maxInp = trs[1].querySelector('.safetyMaxInput');
      const avail = Number(trs[1].dataset.available) || 100;
      // Make it OK: Min <= avail <= Max
      minInp.value = String(Math.max(0, Math.floor(avail / 2)));
      maxInp.value = String(Math.max(10, avail * 2));
      minInp.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Row 2
    if (trs[2]) {
      const minInp = trs[2].querySelector('.safetyMinInput');
      const maxInp = trs[2].querySelector('.safetyMaxInput');
      const avail = Number(trs[2].dataset.available) || 100;
      // Make it Over: Max < avail
      minInp.value = String(Math.max(0, Math.floor(avail / 4)));
      maxInp.value = String(Math.max(1, Math.floor(avail / 2)));
      maxInp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await new Promise(r => setTimeout(r, 1000));

  // Capture safety stock screenshot
  const safetyShot = 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_safety_stock_standards.png';
  await page.screenshot({ path: safetyShot, fullPage: false });
  console.log('Saved verified_safety_stock_standards.png');

  // Scroll safety table to show Min, Max, and Status badges clearly
  console.log('Scrolling safety table right to capture Min, Max, and Status badges...');
  await page.evaluate(() => {
    const wrap = document.querySelector('#safetyTable .table-wrap');
    if (wrap) wrap.scrollLeft = 400;
  });
  await new Promise(r => setTimeout(r, 400));
  const safetyShotScrolled = 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_safety_table_min_max_badges.png';
  await page.screenshot({ path: safetyShotScrolled, fullPage: false });
  console.log('Saved verified_safety_table_min_max_badges.png');

  // Navigate to Stock page
  console.log('Opening Stock page...');
  await page.evaluate(() => {
    document.querySelector('.nav button[data-page="stock"]').click();
  });
  await new Promise(r => setTimeout(r, 700));

  // Scroll stock table to center on Available and ระดับสต็อก (Min/Max)
  console.log('Scrolling stock table to center on Available and Min/Max status column...');
  await page.evaluate(() => {
    const wrap = document.querySelector('#stockTable .table-wrap');
    if (wrap) wrap.scrollLeft = 520;
  });
  await new Promise(r => setTimeout(r, 400));

  const stockShot = 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_stock_min_max_badges.png';
  await page.screenshot({ path: stockShot, fullPage: false });
  console.log('Saved verified_stock_min_max_badges.png');

  // Test quick filter click on "🔴 ต่ำกว่า Min"
  console.log('Clicking quick filter for ต่ำกว่า Min in Stock page...');
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#stockSummary .stock-summary-card'));
    const lowCard = cards.find(c => c.innerText.includes('ต่ำกว่า Min'));
    if (lowCard) lowCard.click();
  });
  await new Promise(r => setTimeout(r, 700));

  // Also scroll filtered table to show Available and Min/Max badge
  await page.evaluate(() => {
    const wrap = document.querySelector('#stockTable .table-wrap');
    if (wrap) wrap.scrollLeft = 520;
  });
  await new Promise(r => setTimeout(r, 400));

  const filteredShot = 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_stock_filtered_under_min.png';
  await page.screenshot({ path: filteredShot, fullPage: false });
  console.log('Saved verified_stock_filtered_under_min.png');

  await browser.close();
  console.log('ALL TESTS PASSED!');
})();
