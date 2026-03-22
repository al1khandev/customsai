const puppeteer = require('puppeteer');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function searchKeden(query) {
  console.log('🔍 Ищу:', query);
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://keden.kgd.gov.kz/tnved', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    // Type in search field
    await page.type('input[type="search"]', query, { delay: 80 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 3000));

    // Get full page text after search
    const pageData = await page.evaluate(() => {
      // Get all text nodes with codes
      var results = [];
      var allElements = document.querySelectorAll('*');
      allElements.forEach(function(el) {
        var text = (el.innerText || '').trim();
        // Find elements that contain 10-digit code at start
        if (/^\d{10}/.test(text) && el.children.length < 5) {
          var code = text.match(/^(\d{10})/)[1];
          var desc = text.replace(code, '').trim();
          if (desc.length > 3) {
            results.push({ code: code, description: desc.slice(0, 300) });
          }
        }
      });
      // Deduplicate
      var seen = {};
      return results.filter(function(r) {
        if (seen[r.code]) return false;
        seen[r.code] = true;
        return true;
      }).slice(0, 10);
    });

    console.log('\n📋 РЕЗУЛЬТАТЫ С ОПИСАНИЯМИ:');
    pageData.forEach(function(r, i) {
      console.log((i+1) + '. ' + r.code + ' — ' + r.description);
    });

    await page.screenshot({ path: 'keden-results.png' });
    console.log('\n📸 keden-results.png');

    return pageData;

  } finally {
    await browser.close();
  }
}

searchKeden('алюминиевая полоса жалюзи');
