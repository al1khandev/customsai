const puppeteer = require('puppeteer');

async function test() {
  console.log('🔍 Пробую запустить puppeteer...');
  console.log('Node version:', process.version);
  console.log('Platform:', process.platform);
  console.log('Arch:', process.arch);

  try {
    // Try with default settings
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    console.log('✅ Puppeteer запустился!');
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log('✅ Страница загружена!');
    await browser.close();
    console.log('✅ Всё работает!');
  } catch (e) {
    console.log('❌ Ошибка:', e.message.slice(0, 200));

    // Try finding Chrome manually
    const { execSync } = require('child_process');
    try {
      const chromePath = execSync('which google-chrome || which chromium || which chromium-browser || ls /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome 2>/dev/null || ls /Applications/Chromium.app/Contents/MacOS/Chromium 2>/dev/null').toString().trim().split('\n')[0];
      console.log('🔍 Нашёл Chrome:', chromePath);

      const browser2 = await puppeteer.launch({
        headless: 'new',
        executablePath: chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      });
      console.log('✅ Запустился с системным Chrome!');
      await browser2.close();
    } catch (e2) {
      console.log('❌ Системный Chrome не найден:', e2.message.slice(0, 100));
    }
  }
}

test();
