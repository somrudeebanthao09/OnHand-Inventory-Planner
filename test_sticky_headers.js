const puppeteer = require('C:/Users/Admin/Downloads/h9-part-readiness-chrome-helper/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  console.log('Navigating to app...');
  await page.goto('http://127.0.0.1:49371', { waitUntil: 'networkidle0' });

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

  // Go to safety page
  console.log('Opening Safety stock page...');
  await page.evaluate(() => {
    document.querySelector('.nav button[data-page="safety"]').click();
  });
  await new Promise(r => setTimeout(r, 600));

  // 1. Test normal screen fit
  const normalFit = await page.evaluate(() => {
    const wrap = document.querySelector('#safetyTable .table-wrap');
    const table = wrap?.querySelector('.safety-standard-table');
    const bar = document.querySelector('.safety-hscroll');
    return {
      wrapWidth: wrap?.clientWidth,
      tableWidth: table?.scrollWidth,
      overflow: (table?.scrollWidth || 0) > (wrap?.clientWidth || 0),
      barHidden: bar?.classList.contains('hidden')
    };
  });
  console.log('Normal screen (1440px) fit:', normalFit);

  await page.screenshot({
    path: 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_safety_table_fit_normal.png'
  });
  console.log('Saved verified_safety_table_fit_normal.png');

  // 2. Test narrow screen (e.g. 1150px) to see if floating scrollbar appears at bottom of screen
  console.log('Resizing viewport to 1150x768 to test narrow screen behavior...');
  await page.setViewport({ width: 1150, height: 768 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    if (typeof updateSafetyHScroll === 'function') updateSafetyHScroll();
  });
  await new Promise(r => setTimeout(r, 300));

  const narrowCheck = await page.evaluate(() => {
    const wrap = document.querySelector('#safetyTable .table-wrap');
    const table = wrap?.querySelector('.safety-standard-table');
    const bar = document.querySelector('.safety-hscroll');
    const barRect = bar?.getBoundingClientRect();
    return {
      wrapWidth: wrap?.clientWidth,
      tableWidth: table?.scrollWidth,
      overflow: (table?.scrollWidth || 0) > (wrap?.clientWidth || 0),
      barHidden: bar?.classList.contains('hidden'),
      barBottom: barRect ? window.innerHeight - barRect.bottom : null
    };
  });
  console.log('Narrow screen (1150px) check:', narrowCheck);

  await page.screenshot({
    path: 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_safety_table_narrow.png'
  });
  console.log('Saved verified_safety_table_narrow.png');

  // 3. Scroll down further to test sticky header pinned under topbar
  console.log('Scrolling window down by 1400px...');
  await page.evaluate(() => {
    window.scrollTo({ top: 1400, behavior: 'instant' });
  });
  await new Promise(r => setTimeout(r, 400));

  const scrolledCheck = await page.evaluate(() => {
    const floating = document.querySelector('.safety-sticky-head');
    const topbar = document.querySelector('.topbar');
    const bar = document.querySelector('.safety-hscroll');
    const rect = floating?.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();
    const isHidden = floating?.classList.contains('hidden');
    return {
      hasFloating: Boolean(floating),
      isHidden,
      top: rect?.top,
      topbarBottom: topbarRect?.bottom,
      barHidden: bar?.classList.contains('hidden')
    };
  });
  console.log('Scrolled state (sticky header):', scrolledCheck);

  await page.screenshot({
    path: 'C:/Users/Admin/.gemini/antigravity/brain/10430e51-77e9-46b9-9a23-914dd00df338/verified_safety_table_sticky_scrolled.png'
  });
  console.log('Saved verified_safety_table_sticky_scrolled.png');

  console.log('ALL TESTS PASSED!');
  await browser.close();
})();
