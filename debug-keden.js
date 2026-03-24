const puppeteer = require('puppeteer');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function searchKeden(query) {
  console.log('🔍 Ищу:', query);
  let browser = null;

  // Retry mechanism - try up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔍 Попытка ${attempt}/3 поиска на keden.kgd.gov.kz: "${query}"`);

      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: CHROME_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      });

      const page = await browser.newPage();

      // Set reasonable timeouts
      await page.setDefaultNavigationTimeout(30000); // 30 seconds
      await page.setDefaultTimeout(20000); // 20 seconds

      // Set user agent to avoid detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Enable request interception to see what's happening
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // console.log('Request:', request.url());
        request.continue();
      });

      page.on('response', (response) => {
        // console.log('Response:', response.url(), response.status());
      });

      // Navigate to the site
      console.log('🌐 Навигация к keden.kgd.gov.kz/tnved');
      await page.goto('https://keden.kgd.gov.kz/tnved', { waitUntil: 'networkidle2' });
      console.log('✅ Навигация завершена');

      // Wait for page to be fully loaded with dynamic content
      console.log('⏳ Ожидание готовности документа');
      await page.waitForFunction(() => document.readyState === 'complete');
      console.log('✅ Документ готов');

      // Additional wait for React to render (using polling instead of fixed timeout)
      console.log('⏳ Ожидание рендера React');
      await page.waitForFunction(() => {
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="оиск"], input[placeholder*="овар"], .ant-input, input');
        return searchInput !== null;
      }, { timeout: 15000 }).catch(() => {
        // If specific selector not found, try any input
        console.log('⚠️ Специфичный селектор не найден, пробуем любой input');
        return page.waitForFunction(() => {
          const inputs = document.querySelectorAll('input');
          return inputs.length > 0;
        }, { timeout: 10000 });
      });
      console.log('✅ React рендер завершен');

      // Try multiple selectors for search input
      console.log('🔍 Поиск поля ввода');
      let searchInput = await page.$('input[type="search"]');
      if (!searchInput) searchInput = await page.$('input[placeholder*="оиск"]');
      if (!searchInput) searchInput = await page.$('input[placeholder*="овар"]');
      if (!searchInput) searchInput = await page.$('.ant-input');
      if (!searchInput) searchInput = await page.$('input');

      if (!searchInput) {
        // Let's see what inputs are actually available
        const allInputs = await page.$$('input');
        console.log(`🔍 Найдено ${allInputs.length} input элементов:`);
        for (let i = 0; i < allInputs.length; i++) {
          const placeholder = await allInputs[i].getAttribute('placeholder') || '';
          const type = await allInputs[i].getAttribute('type') || '';
          const className = await allInputs[i].getAttribute('class') || '';
          console.log(`  ${i+1}. type="${type}" placeholder="${placeholder}" class="${className}"`);
        }
        throw new Error('Search input not found');
      }

      console.log('✅ Поле ввода найдено');

      // Get initial page content to see what we're working with
      const initialTitle = await page.title();
      console.log(`📄 Заголовок страницы: ${initialTitle}`);

      // Click and type with human-like delays
      console.log('🖱️ Клик по полю ввода');
      await searchInput.click();
      await page.waitForTimeout(500);

      console.log('⌨️ Ввод запроса:', query);
      // Type query with realistic delay between characters
      for (const char of query) {
        await searchInput.type(char, { delay: Math.random() * 100 + 50 });
      }

      await page.keyboard.press('Enter');
      console.log('▶️ Нажата клавиша Enter');

      // Wait for results to load - wait for network idle or specific content
      console.log('⏳ Ожидание загрузки результатов');
      try {
        await page.waitForFunction(() => {
          const pageText = document.body.innerText || '';
          return pageText.includes('ТН ВЭД') || pageText.includes('код') ||
                 document.querySelectorAll('*').length > 100;
        }, { timeout: 15000 });
        console.log('✅ Результаты загружены');
      } catch (e) {
        console.log('⚠️ Специфичное условие не выполнено, ждем 3 сек anyway');
        // If specific condition not met, wait a bit anyway
        await page.waitForTimeout(3000);
      }

      // Extract results with improved logic
      console.log('📊 Извлечение результатов');
      const results = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        // Look for elements that likely contain TN VED codes
        const allElements = document.querySelectorAll('*');
        console.log(`🔍 Всего элементов на странице: ${allElements.length}`);

        allElements.forEach(el => {
          const text = (el.innerText || '').trim();
          // Match 10-digit code at start of text
          if (/^\d{10}/.test(text) && el.children.length < 10) {
            const codeMatch = text.match(/^(\d{10})/);
            if (codeMatch) {
              const code = codeMatch[1];
              const desc = text.replace(code, '').trim();

              // Only add if description is meaningful and not duplicate
              if (desc.length > 3 && !seen.has(code)) {
                seen.add(code);
                results.push({
                  code: code,
                  description: desc.slice(0, 500) // Increased description length
                });
              }
            }
          }
        });

        // Sort by relevance (longer descriptions first) and limit results
        return results
          .sort((a, b) => b.description.length - a.description.length)
          .slice(0, 10);
      });

      await browser.close();
      browser = null;

      console.log(`🌐 Keden: найдено ${results.length} результатов для "${query}"`);
      results.forEach((r, i) => {
        console.log(`  ${i+1}. ${r.code} — ${r.description.slice(0, 80)}`);
      });

      return results;
    } catch (error) {
      console.log(`⚠️ Попытка ${attempt}/3 не удалась:`, error.message.slice(0, 150));

      // Close browser if it was opened
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          console.log('Ошибка при закрытии браузера:', e.message);
        }
        browser = null;
      }

      // If this was the last attempt, re-throw the error
      if (attempt === 3) {
        console.log('❌ Все попытки поиска на keden.kgd.gov.kz исчерпаны');
        throw error;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }

  // Should never reach here, but just in case
  return [];
}

// Test the function
searchKeden('алюминиевая полоса жалюзи')
  .then(results => {
    console.log('\n✅ Тест завершен успешно');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Тест завершен с ошибкой:', error.message);
    process.exit(1);
  });