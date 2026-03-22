process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const NVIDIA_API_KEY = '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';

// Локальная база ТН ВЭД
var TNVED_DB = {};
try { TNVED_DB = require('./tnved_db.js'); } catch(e) { console.log('⚠️ tnved_db.js не найден'); }

function lookupTnvedDB(name, material) {
  var query = ((name || '') + ' ' + (material || '')).toLowerCase().trim();
  var best = null, bestScore = 0;
  Object.keys(TNVED_DB).forEach(function(key) {
    var score = 0;
    var keyWords = key.split(' ');
    keyWords.forEach(function(w) { if (query.includes(w)) score += w.length; });
    if (score > bestScore) { bestScore = score; best = {key: key, data: TNVED_DB[key], score: score}; }
  });
  // Only return if confident match (score > 3)
  return bestScore > 3 ? best : null;
}

// Auto-detect Chrome path (Mac or Linux)
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/chromium');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

// ── Веб-сервер — панель управления ───────────────────────────────────────
var currentQR = null;
var botState = 'disconnected';
var connectedPhone = '';
var KEYWORD = 'декларация 777';
var SETTINGS_FILE = path.join(__dirname, 'settings.json');
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      var s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (s.keyword) return s;
    }
  } catch(e) {}
  return { keyword: KEYWORD };
}
function saveSettingsFile(obj) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2)); } catch(e) {}
}
function getCurrentSettings() {
  return { keyword: KEYWORD_DYNAMIC, msg_limit: MSG_LIMIT };
}
var appSettings = loadSettings();
var KEYWORD_DYNAMIC = appSettings.keyword;
var MSG_LIMIT = appSettings.msg_limit || 40;
console.log('🔑 Загружено кодовое слово: "' + KEYWORD_DYNAMIC + '"');
var manualChats = []; // история ручного ввода
var statsCount = 0;

var webServer = http.createServer(function(req, res) {
  var url = req.url.split('?')[0];

  // Add ngrok bypass header to all responses
  res.setHeader('ngrok-skip-browser-warning', 'true');

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getPanelHTML());

  } else if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      state: botState,
      phone: connectedPhone,
      keyword: KEYWORD_DYNAMIC,
      stats: statsCount,
      msg_limit: MSG_LIMIT,
      hasQR: currentQR ? true : false
    }));

  } else if (url === '/qr.png' && currentQR) {
    QRCode.toBuffer(currentQR, { width: 280, margin: 2, color: { dark: '#000000', light: '#ffffff' } }, function(err, buf) {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(buf);
    });

  } else if (url === '/set-limit' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var limit = parseInt(data.limit);
        if (limit >= 10 && limit <= 200) {
          MSG_LIMIT = limit;
          saveSettingsFile({ keyword: KEYWORD_DYNAMIC, msg_limit: MSG_LIMIT });
          console.log('🧠 Лимит сообщений изменён на: ' + MSG_LIMIT);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, limit: MSG_LIMIT }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ ok: false }));
        }
      } catch(e) { res.writeHead(400); res.end(); }
    });

  } else if (url === '/set-keyword' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (data.keyword && data.keyword.trim().length > 0) {
          KEYWORD_DYNAMIC = data.keyword.trim();
          saveSettingsFile({ keyword: KEYWORD_DYNAMIC });
          console.log('🔑 Кодовое слово изменено на: "' + KEYWORD_DYNAMIC + '"');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, keyword: KEYWORD_DYNAMIC }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ ok: false }));
        }
      } catch(e) { res.writeHead(400); res.end(); }
    });

  } else if (url === '/manual' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);
        var chatText = data.text || '';
        if (!chatText.trim()) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Пустой текст' })); return; }

        console.log('✍️ Ручной ввод через панель...');
        var invoiceData = null;
        var parsed = await analyzeChat(chatText, invoiceData);

        if (!parsed.exchange_rate || parsed.exchange_rate === '0') {
          var rate = await getExchangeRate(parsed.currency || 'USD');
          if (rate) parsed.exchange_rate = rate;
        }

        for (var gi = 0; gi < (parsed.goods || []).length; gi++) {
          var good = parsed.goods[gi];
          if (!good.tnved) good.tnved = await getTnved(good.name, good.material);
        }

        var pdfPath = await generateDTPDF(parsed);
        var pdfData = fs.readFileSync(pdfPath);

        var clientName = (parsed.declarant_name || 'manual').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_').slice(0, 40);
        var dateStr = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
        var saveDir = path.join(__dirname, 'declarations', clientName + '_' + dateStr);
        if (!fs.existsSync(path.join(__dirname, 'declarations'))) fs.mkdirSync(path.join(__dirname, 'declarations'));
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
        var savePath = path.join(saveDir, 'declaration_' + Date.now() + '.pdf');
        fs.copyFileSync(pdfPath, savePath);
        fs.unlinkSync(pdfPath);

        statsCount++;
        manualChats.unshift({ time: new Date().toLocaleString('ru-RU'), client: parsed.declarant_name || '—', goods: (parsed.goods||[]).length, path: savePath });
        if (manualChats.length > 20) manualChats.pop();

        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="declaration.pdf"' });
        res.end(pdfData);
      } catch(e) {
        console.error('❌ Ошибка ручного ввода:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });

  } else if (url === '/parse' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);
        var parsed = await analyzeChat(data.text || '', null);
        if (!parsed.exchange_rate) {
          var rate = await getExchangeRate(parsed.currency || 'USD');
          if (rate) parsed.exchange_rate = rate;
        }
        for (var gi = 0; gi < (parsed.goods || []).length; gi++) {
          if (!parsed.goods[gi].tnved) parsed.goods[gi].tnved = await getTnved(parsed.goods[gi].name);
        }
        var validation = validateDeclarationData(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          data: parsed,
          validation: validation
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });

  } else if (url === '/generate' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);

        // Validate before generating — never create with missing required data
        var validation = validateDeclarationData(data);
        if (!validation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: 'Не хватает обязательных данных',
            missing_required: validation.required,
            missing_optional: validation.optional
          }));
          return;
        }

        var pdfPath = await generateDTPDF(data);
        var pdfData = fs.readFileSync(pdfPath);
        var clientName = (data.declarant_name || 'manual').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_').slice(0, 40);
        var dateStr = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
        var saveDir = path.join(__dirname, 'declarations', clientName + '_' + dateStr);
        if (!fs.existsSync(path.join(__dirname, 'declarations'))) fs.mkdirSync(path.join(__dirname, 'declarations'));
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
        var savePath = path.join(saveDir, 'declaration_' + Date.now() + '.pdf');
        fs.copyFileSync(pdfPath, savePath);
        fs.unlinkSync(pdfPath);
        statsCount++;
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="declaration.pdf"' });
        res.end(pdfData);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });

  } else if (url === '/search-tnved' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);
        var goodsName = data.name || '';
        var material = data.material || '';

        if (!goodsName) { res.writeHead(400); res.end(JSON.stringify({error:'No name'})); return; }

        // Search ONLY on keden.kgd.gov.kz — no AI generation
        var kedenQuery = goodsName + (material ? ' ' + material : '');
        var kedenResults = await searchKeden(kedenQuery);

        if (!kedenResults || kedenResults.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Товар не найден на keden.kgd.gov.kz. Попробуйте другое название.' }));
          return;
        }

        var best = kedenResults[0];
        var result = {
          code: best.code,
          description: best.description,
          duty_rate: '',
          vat: '12%',
          reason: 'Источник: keden.kgd.gov.kz (официальный портал КГД РК)',
          confidence: 'high',
          source: 'keden.kgd.gov.kz',
          all_results: kedenResults
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (url === '/dl-json') {
    var filePath = req.url.split('path=')[1];
    if (filePath) filePath = decodeURIComponent(filePath);
    // Convert PDF path to JSON path
    if (filePath && filePath.endsWith('.pdf')) filePath = filePath.replace('.pdf', '_data.json');
    // Handle /dl/ prefix paths
    if (filePath && filePath.startsWith('/dl/')) {
      var parts = filePath.replace('/dl/', '').split('/');
      filePath = path.join(__dirname, 'declarations', parts[0], parts[1]);
    }
    if (filePath && fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'JSON file not found: ' + filePath }));
    }

  } else if (url === '/regenerate' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var parsed = JSON.parse(body);
        var data = parsed.data;
        var origPdfPath = parsed.pdfPath;

        var pdfPath = await generateDTPDF(data);
        var pdfData = fs.readFileSync(pdfPath);

        // Overwrite original if path known
        if (origPdfPath && origPdfPath.startsWith('/dl/')) {
          var parts = origPdfPath.replace('/dl/', '').split('/');
          var realPath = path.join(__dirname, 'declarations', parts[0], parts[1]);
          if (fs.existsSync(path.dirname(realPath))) {
            fs.copyFileSync(pdfPath, realPath);
            fs.writeFileSync(realPath.replace('.pdf', '_data.json'), JSON.stringify(data, null, 2));
          }
        }

        fs.unlinkSync(pdfPath);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="declaration_edited.pdf"' });
        res.end(pdfData);
      } catch(e) {
        console.error('Regenerate error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (url === '/logout' && req.method === 'POST') {
    client.logout().catch(function(){});
    res.writeHead(200); res.end('ok');

  } else if (url === '/declarations') {
    var dir = path.join(__dirname, 'declarations');
    var items = [];
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).reverse().slice(0, 20).forEach(function(folder) {
        var fpath = path.join(dir, folder);
        if (fs.statSync(fpath).isDirectory()) {
          var files = fs.readdirSync(fpath).filter(function(f) { return f.endsWith('.pdf'); });
          files.forEach(function(f) {
            items.push({ name: folder, file: f, path: '/dl/' + folder + '/' + f });
          });
        }
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));

  } else if (url === '/get-data' && req.method === 'GET') {
    var folder = decodeURIComponent(req.url.split('folder=')[1] || '');
    if (!folder) { res.writeHead(400); res.end('{}'); return; }
    var jsonPath = path.join(__dirname, 'declarations', folder.split('/')[0], folder.split('/')[1].replace('.pdf', '_data.json'));
    if (fs.existsSync(jsonPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(jsonPath, 'utf8'));
    } else {
      res.writeHead(404); res.end('{}');
    }

  } else if (url === '/regenerate' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', async function() {
      try {
        var data = JSON.parse(body);
        var pdfPath = await generateDTPDF(data);
        var pdfData = fs.readFileSync(pdfPath);
        fs.unlinkSync(pdfPath);

        // Save updated JSON
        if (data._savePath) {
          var jsonPath = data._savePath.replace('.pdf', '_data.json');
          fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
          // Overwrite PDF
          fs.writeFileSync(data._savePath, pdfData);
        }

        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="declaration_edited.pdf"' });
        res.end(pdfData);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (url.startsWith('/dl/')) {
    var parts = url.replace('/dl/', '').split('/');
    var filePath = path.join(__dirname, 'declarations', parts[0], parts[1]);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      fs.createReadStream(filePath).pipe(res);
    } else { res.writeHead(404); res.end(); }

  } else {
    res.writeHead(404); res.end();
  }
});

webServer.listen(3000, function() {
  console.log('🌐 Панель управления: http://localhost:3000');
});

function getPanelHTML() {
  try {
    return require('fs').readFileSync(require('path').join(__dirname, 'panel.html'), 'utf8');
  } catch(e) {
    return '<h1>panel.html not found</h1>';
  }
}


// ── Валидация данных декларации ───────────────────────────────────────────
function validateDeclarationData(data) {
  var required = [];
  var optional = [];

  if (!data.declarant_name) required.push('название компании или ФИО декларанта');
  if (!data.declarant_inn) required.push('БИН / ИИН');
  if (!data.exporter_name) required.push('название компании отправителя');
  if (!data.exporter_country) required.push('страна отправления');
  if (!data.currency) required.push('валюта (USD/EUR/CNY)');
  if (!data.total_invoice_amount) required.push('общая сумма по инвойсу');
  if (!data.goods || data.goods.length === 0) required.push('список товаров');
  if (data.goods) {
    data.goods.forEach(function(g, i) {
      if (!g.name) required.push('наименование товара ' + (i+1));
      if (!g.total_price) required.push('цена товара ' + (i+1));
    });
  }

  if (!data.declarant_address) optional.push('адрес декларанта');
  if (!data.delivery_terms) optional.push('условия поставки (CIP/FOB/EXW)');
  if (!data.transport_id) optional.push('номер контейнера');
  if (!data.border_crossing) optional.push('таможенный пост');
  if (!data.gross_weight) optional.push('общий вес брутто (кг)');
  if (!data.invoice_number) optional.push('номер инвойса');
  if (!data.contract_number) optional.push('номер контракта');
  if (!data.packages_count) optional.push('количество мест');
  if (data.goods) {
    data.goods.forEach(function(g, i) {
      if (!g.gross_weight) optional.push('вес товара ' + (i+1) + ' (' + (g.name||'?') + ')');
      if (!g.quantity) optional.push('количество товара ' + (i+1));
    });
  }

  return { required: required, optional: optional, valid: required.length === 0 };
}

// ── NVIDIA API ─────────────────────────────────────────────────────────────
function callNvidia(prompt) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'meta/llama-3.3-70b-instruct',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    var agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
    var options = {
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + NVIDIA_API_KEY,
        'Content-Length': Buffer.byteLength(body)
      },
      rejectUnauthorized: false,
      agent: agent
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          resolve(result.choices[0].message.content);
        } catch(e) {
          reject(new Error('API parse error: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', function(e) { reject(e); });
    req.setTimeout(30000, function() { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Курс НБРК ─────────────────────────────────────────────────────────────
function getExchangeRate(currency) {
  return new Promise(function(resolve) {
    var https = require('https');
    var req = https.get('https://www.nationalbank.kz/rss/rates_all.xml', { rejectUnauthorized: false }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var cur = (currency || 'USD').toUpperCase();
          var regex = new RegExp('<item>[\s\S]*?<title>' + cur + '<\/title>[\s\S]*?<description>([\d\.]+)<\/description>', 'i');
          var match = data.match(regex);
          if (match) {
            console.log('💱 Курс ' + cur + ' от НБРК: ' + match[1]);
            resolve(parseFloat(match[1]).toFixed(2));
          } else {
            console.log('⚠️ Курс ' + cur + ' не найден, использую 0');
            resolve('');
          }
        } catch(e) {
          console.log('⚠️ Ошибка получения курса:', e.message);
          resolve('');
        }
      });
    });
    req.on('error', function() { resolve(''); });
    req.setTimeout(5000, function() { req.destroy(); resolve(''); });
  });
}

// ── Проверка ТН ВЭД ────────────────────────────────────────────────────────
async function checkTnved(code, goodsName) {
  if (!code || code.length < 4) return { ok: false, msg: 'Код слишком короткий' };
  try {
    var prompt = 'You are a Kazakhstan customs expert. Check if this TNVED (HS) code is correct for this product.\n\nProduct: ' + goodsName + '\nTNVED code: ' + code + '\n\nRespond with ONLY JSON: {"correct": true/false, "confidence": "high/medium/low", "suggestion": "correct 10-digit code if wrong or same code if correct", "reason": "brief explanation in Russian"}';
    var text = await callNvidia(prompt);
    text = text.replace(/```json|```/g, '').trim();
    var match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { ok: true };
  } catch(e) { return { ok: true }; }
}

// ── Распознавание фото инвойса ────────────────────────────────────────────
function recognizeInvoice(base64data, mimetype) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'meta/llama-3.3-70b-instruct',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:' + (mimetype||'image/jpeg') + ';base64,' + base64data } },
          { type: 'text', text: 'Extract all data from this invoice/document image. Return ONLY JSON: {"invoice_number":"","invoice_date":"","exporter_name":"","exporter_address":"","contract_number":"","currency":"","goods":[{"name":"","quantity":"","unit":"","price":"","total":""}],"total_amount":""}. Empty string if not found.' }
        ]
      }]
    });

    var agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
    var options = {
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + NVIDIA_API_KEY, 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false, agent: agent
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          var text = result.choices[0].message.content;
          text = text.replace(/```json|```/g, '').trim();
          var match = text.match(/\{[\s\S]*\}/);
          resolve(match ? JSON.parse(match[0]) : null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function(e) { resolve(null); });
    req.setTimeout(30000, function() { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Анализ переписки ───────────────────────────────────────────────────────
async function analyzeChat(chatText, invoiceData) {
  var invoiceContext = invoiceData ? '\n\nADDITIONAL DATA FROM INVOICE PHOTO: ' + JSON.stringify(invoiceData) : '';
  var prompt = 'You are a Kazakhstan customs expert. Extract data from this WhatsApp chat for a customs Declaration on Goods (DT). Return ONLY raw JSON, nothing else.\n\nCRITICAL RULES:\n- NEVER invent, guess or fill in missing data\n- If a field is not explicitly mentioned in the chat, leave it as empty string ""\n- Only extract what is clearly stated\n- For goods: extract material/composition if mentioned (cotton, aluminum, plastic, steel)\n- Do NOT make up TNVED codes, weights, prices or any numbers not in the chat\n\nIMPORTANT RULES:\n- Extract ALL goods mentioned, do not skip any\n- currency must be exactly as mentioned (USD, EUR, etc) - do NOT convert\n- total_invoice_amount is the invoice total in the original currency\n- exchange_rate is KZT rate (e.g. 492.30)\n- gross_weight is in kg\n- For each good: total_price is price in original currency\n\nCHAT:\n' + chatText + '\n\nReturn ONLY this JSON structure:\n{"declarant_name":"","declarant_inn":"","declarant_address":"","exporter_name":"","exporter_country":"","exporter_address":"","delivery_terms":"","currency":"USD","total_invoice_amount":"","exchange_rate":"","transport_type":"20","transport_id":"","border_crossing":"","gross_weight":"","packages_count":"","invoice_number":"","invoice_date":"","contract_number":"","goods":[{"name":"","tnved":"","origin_country":"CN","gross_weight":"","net_weight":"","quantity":"","unit":"","total_price":"","customs_procedure":"4000"}]}\n\nExtract every single product mentioned. Empty string if not found.';

  var text = await callNvidia(prompt);
  text = text.replace(/```json|```/g, '').trim();
  var match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  var data = JSON.parse(text);

  // Определяем ТН ВЭД для товаров без кода
  for (var i = 0; i < (data.goods || []).length; i++) {
    var good = data.goods[i];
    if (!good.tnved || good.tnved.length < 4) {
      console.log('🔍 Определяю ТН ВЭД для: ' + good.name);
      good.tnved = await getTnved(good.name);
      console.log('   → ' + good.tnved);
    }
  }

  return data;
}

// ── Определение ТН ВЭД ────────────────────────────────────────────────────
// ── Поиск ТН ВЭД через keden.kgd.gov.kz ─────────────────────────────────
async function searchKeden(query) {
  var puppeteer = require('puppeteer');
  var browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
    });
    var page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto('https://keden.kgd.gov.kz/tnved', { waitUntil: 'domcontentloaded' });

    // Wait longer for React to render
    await new Promise(function(r) { setTimeout(r, 8000); });

    // Try multiple selectors
    var searchInput = await page.$('input[type="search"]') ||
                      await page.$('input[placeholder*="оиск"]') ||
                      await page.$('input[placeholder*="овар"]') ||
                      await page.$('.ant-input') ||
                      await page.$('input');

    if (!searchInput) throw new Error('Search input not found after 8s wait');

    await searchInput.click();
    await new Promise(function(r) { setTimeout(r, 500); });
    await searchInput.type(query, { delay: 100 });
    await page.keyboard.press('Enter');
    await new Promise(function(r) { setTimeout(r, 5000); });

    // Extract results with descriptions
    var results = await page.evaluate(function() {
      var results = [];
      var seen = {};
      var allElements = document.querySelectorAll('*');
      allElements.forEach(function(el) {
        var text = (el.innerText || '').trim();
        if (/^\d{10}/.test(text) && el.children.length < 5) {
          var code = text.match(/^(\d{10})/)[1];
          var desc = text.replace(code, '').trim();
          if (desc.length > 3 && !seen[code]) {
            seen[code] = true;
            results.push({ code: code, description: desc.slice(0, 300) });
          }
        }
      });
      return results.slice(0, 10);
    });

    await browser.close();
    console.log('🌐 Keden: найдено ' + results.length + ' результатов для "' + query + '"');
    results.forEach(function(r, i) {
      console.log('  ' + (i+1) + '. ' + r.code + ' — ' + r.description.slice(0, 80));
    });
    return results;
  } catch(e) {
    if (browser) try { await browser.close(); } catch(e2) {}
    console.log('⚠️ Keden недоступен:', e.message.slice(0, 100));
    return [];
  }
}

async function getTnved(goodsName, material) {
  var matInfo = material ? ', материал: ' + material : '';
  console.log('🔍 Определяю ТН ВЭД: ' + goodsName + matInfo);

  // ТОЛЬКО официальный источник — keden.kgd.gov.kz
  // ИИ НЕ используется для кодов
  var kedenQuery = goodsName + (material ? ' ' + material : '');
  var kedenResults = await searchKeden(kedenQuery);

  if (kedenResults && kedenResults.length > 0) {
    console.log('✅ ТН ВЭД с keden.kgd.gov.kz: ' + kedenResults[0].code + ' — ' + kedenResults[0].description.slice(0,60));
    return kedenResults[0].code;
  }

  // Если сайт недоступен — возвращаем пустую строку
  // Менеджер должен заполнить вручную
  console.log('⚠️ keden.kgd.gov.kz недоступен — код ТН ВЭД нужно заполнить вручную');
  return '';
}

// ── Генерация PDF (ДТ форма) ───────────────────────────────────────────────
function generateDTPDF(data) {
  function g(key) { return (data[key] || '').toString(); }

  var today = new Date().toLocaleDateString('ru-RU');
  var regNum = g('ref_number') || ('55302/' + new Date().toLocaleDateString('ru-RU').replace(/\./g,'') + '/' + Math.floor(Math.random()*9999999).toString().padStart(7,'0'));

  var goodsRows = (data.goods || []).map(function(item, i) {
    var totalP = parseFloat(item.total_price) || 0;
    return '<tr>' +
      '<td style="text-align:center">' + (i+1) + '</td>' +
      '<td>' + (item.name || '') + '</td>' +
      '<td style="text-align:center;font-weight:bold">' + (item.tnved || '') + '</td>' +
      '<td style="text-align:center">' + (item.origin_country || 'CN') + '</td>' +
      '<td style="text-align:right">' + (item.gross_weight || '') + '</td>' +
      '<td style="text-align:right">' + (item.net_weight || '') + '</td>' +
      '<td style="text-align:center">' + (item.quantity || '') + ' ' + (item.unit || '') + '</td>' +
      '<td style="text-align:right">' + g('currency') + ' ' + (totalP > 0 ? totalP.toFixed(2) : (item.total_price || '')) + '</td>' +
      '<td style="text-align:center">' + (item.customs_procedure || '4000') + '</td>' +
      '</tr>';
  }).join('');

  var totalWeight = (data.goods || []).reduce(function(s,item){return s+(parseFloat(item.gross_weight)||0);},0).toFixed(2);
  var totalPrice = (data.goods || []).reduce(function(s,item){return s+(parseFloat(item.total_price)||0);},0).toFixed(2);

  var html = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><style>'
    + '@page{size:A4 landscape;margin:8mm}'
    + '*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif;font-size:7pt}'
    + '.page{width:100%}'
    + '.title-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:2mm}'
    + '.main-title{font-size:11pt;font-weight:bold;text-align:center;flex:1}'
    + '.reg-num{font-size:8pt;text-align:right}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:2mm}'
    + 'td,th{border:1px solid #000;padding:1.5px 2px;vertical-align:top;font-size:6.5pt}'
    + 'th{background:#e8e8e8;font-weight:bold;text-align:center;font-size:6pt}'
    + '.field-label{font-size:5.5pt;color:#555}'
    + '.field-value{font-size:7pt;font-weight:bold}'
    + '.bold{font-weight:bold}'
    + '.right{text-align:right}'
    + '</style></head><body>'
    + '<div class="page">'

    // Заголовок
    + '<div class="title-row">'
    + '<div style="font-size:6pt">1 ДЕКЛАРАЦИЯ<br><span style="font-size:8pt;font-weight:bold">ИМ 40</span></div>'
    + '<div class="main-title">ДЕКЛАРАЦИЯ НА ТОВАРЫ</div>'
    + '<div class="reg-num">Рег. № ДТ<br><strong>' + regNum + '</strong></div>'
    + '</div>'

    // Отправитель / Получатель
    + '<table><tr>'
    + '<td style="width:30%"><div class="field-label">2 Отправитель/Экспортер</div><div class="field-value">' + g('exporter_name') + '<br>' + g('exporter_country') + '<br>' + g('exporter_address') + '</div></td>'
    + '<td style="width:8%"><div class="field-label">3 Формы</div><div class="field-value">1</div><div class="field-label">4 Отгр.</div></td>'
    + '<td style="width:8%"><div class="field-label">5 Всего т-ов</div><div class="field-value">' + (data.goods||[]).length + '</div></td>'
    + '<td style="width:8%"><div class="field-label">6 Всего мест</div><div class="field-value">' + g('packages_count') + '</div></td>'
    + '<td style="width:20%"><div class="field-label">7 Справочный номер</div><div class="field-value">' + regNum + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:35%"><div class="field-label">8 Получатель &nbsp; № ' + g('declarant_inn') + '</div><div class="field-value">' + g('declarant_name') + '<br>' + g('declarant_address') + '</div></td>'
    + '<td style="width:35%"><div class="field-label">9 Лицо, ответственное за финансовое урегулирование &nbsp; № ' + g('declarant_inn') + '</div><div class="field-value">' + g('declarant_name') + '<br>' + g('declarant_address') + '</div></td>'
    + '<td style="width:10%"><div class="field-label">11 Торг.страна</div><div class="field-value">' + g('exporter_country') + '</div></td>'
    + '<td style="width:20%"><div class="field-label">12 ОБЩАЯ ТАМОЖЕННАЯ СТОИМОСТЬ</div><div class="field-value">' + (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2) + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:35%"><div class="field-label">14 Декларант &nbsp; № ' + g('declarant_inn') + '</div><div class="field-value">' + g('declarant_name') + '<br>' + g('declarant_address') + '</div></td>'
    + '<td style="width:15%"><div class="field-label">15 Страна отправления</div><div class="field-value">' + g('exporter_country') + '</div></td>'
    + '<td style="width:8%"><div class="field-label">15а Код</div><div class="field-value">CN</div></td>'
    + '<td style="width:15%"><div class="field-label">17 Страна назначения</div><div class="field-value">КАЗАХСТАН</div></td>'
    + '<td style="width:7%"><div class="field-label">17 Код</div><div class="field-value">KZ</div></td>'
    + '<td style="width:10%"><div class="field-label">16 Страна происхождения</div><div class="field-value">' + g('exporter_country') + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:25%"><div class="field-label">18 Идентификация трансп.средства</div><div class="field-value">1:' + g('transport_id') + '</div></td>'
    + '<td style="width:5%"><div class="field-label">19</div><div class="field-value">1</div></td>'
    + '<td style="width:20%"><div class="field-label">20 Условия поставки</div><div class="field-value">' + g('delivery_terms') + '</div></td>'
    + '<td style="width:15%"><div class="field-label">22 Валюта и сумма по счету</div><div class="field-value">' + g('currency') + ' ' + g('total_invoice_amount') + '</div></td>'
    + '<td style="width:8%"><div class="field-label">23 Курс валюты</div><div class="field-value">' + g('exchange_rate') + '</div></td>'
    + '<td style="width:7%"><div class="field-label">25 Вид</div><div class="field-value">' + g('transport_type') + '</div></td>'
    + '<td style="width:10%"><div class="field-label">35 Вес брутто общий</div><div class="field-value">' + totalWeight + ' кг</div></td>'
    + '<td style="width:10%"><div class="field-label">28 Финансовые сведения</div><div class="field-value">' + g('financial_doc') + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:25%"><div class="field-label">29 Орган въезда/выезда</div><div class="field-value">' + g('border_crossing') + '</div></td>'
    + '<td style="width:25%"><div class="field-label">30 Местонахождение товаров</div></td>'
    + '<td style="width:25%"><div class="field-label">6 Всего мест / 27 Место погрузки</div><div class="field-value">' + g('packages_count') + ' мест</div></td>'
    + '<td style="width:25%"><div class="field-label">Инвойс / Контракт</div><div class="field-value">' + g('invoice_number') + ' от ' + g('invoice_date') + '<br>' + g('contract_number') + '</div></td>'
    + '</tr></table>'

    // Товары
    + '<div class="field-label" style="font-weight:bold;margin:1mm 0">ТОВАРЫ:</div>'
    + '<table><thead><tr>'
    + '<th style="width:3%">№</th>'
    + '<th style="width:28%">31 Наименование товара</th>'
    + '<th style="width:10%">33 Код ТН ВЭД</th>'
    + '<th style="width:5%">34 Страна</th>'
    + '<th style="width:7%">35 Брутто (кг)</th>'
    + '<th style="width:7%">38 Нетто (кг)</th>'
    + '<th style="width:8%">41 Кол-во/ЕИ</th>'
    + '<th style="width:10%">42 Цена товара</th>'
    + '<th style="width:7%">37 Процедура</th>'
    + '</tr></thead>'
    + '<tbody>' + goodsRows + '</tbody>'
    + '<tfoot><tr>'
    + '<td colspan="4" style="text-align:right;font-weight:bold">ИТОГО:</td>'
    + '<td style="text-align:right;font-weight:bold">' + totalWeight + ' кг</td>'
    + '<td></td><td></td>'
    + '<td style="text-align:right;font-weight:bold">' + g('currency') + ' ' + totalPrice + '</td>'
    + '<td></td>'
    + '</tr></tfoot></table>'

    // Документы и платежи
    + '<table><tr>'
    + '<td style="width:60%"><div class="field-label">44 Дополнительная информация / Представленные документы</div>'
    + '<div class="field-value">'
    + '02013 &nbsp; ' + g('railway_bill') + ' Железнодорожная накладная<br>'
    + '04021 &nbsp; ' + g('invoice_number') + ' от ' + g('invoice_date') + ' Счет-фактура (инвойс)<br>'
    + '03011 &nbsp; ' + g('contract_number') + ' Договор (контракт)'
    + '</div></td>'
    + '<td style="width:40%">'
    + '<div class="field-label">47 Исчисление платежей</div>'
    + '<table style="margin:0"><tr><th>Вид</th><th>Основа начисления</th><th>Ставка</th><th>Сумма</th><th>СП</th></tr>'
    + '<tr><td>1010</td><td>' + g('currency') + ' ' + totalPrice + '</td><td>25 950 тг</td><td>—</td><td>ИУ</td></tr>'
    + '<tr><td>2010</td><td>' + g('currency') + ' ' + totalPrice + '</td><td>—%</td><td>—</td><td>ИУ</td></tr>'
    + '<tr><td>5060</td><td>' + g('currency') + ' ' + totalPrice + '</td><td>16%</td><td>—</td><td>ИУ</td></tr>'
    + '</table></td>'
    + '</tr></table>'

    // Подпись
    + '<table><tr>'
    + '<td style="width:40%"><div class="field-label">54 Место и дата</div><div class="field-value">' + today + '</div></td>'
    + '<td style="width:60%"><div class="field-label">Подпись и ФИО декларанта</div><div class="field-value">' + g('declarant_name') + '</div></td>'
    + '</tr></table>'

    + '<div style="border:1px solid #000;padding:2mm;margin-top:2mm;min-height:15mm">'
    + '<div class="field-label">D Контроль в пункте назначения / Штамп:</div>'
    + '</div>'

    + '</div></body></html>';

  var htmlPath = require('path').join(__dirname, 'dt_' + Date.now() + '.html');
  var pdfPath = htmlPath.replace('.html', '.pdf');
  require('fs').writeFileSync(htmlPath, html, 'utf8');

  return new Promise(function(resolve, reject) {
        var pyScript = htmlPath.replace('.html', '.py');
    var pyLines = [];
    pyLines.push('from weasyprint import HTML');
    pyLines.push('HTML(filename=' + JSON.stringify(htmlPath) + ').write_pdf(' + JSON.stringify(pdfPath) + ')');
    require('fs').writeFileSync(pyScript, pyLines.join('\n'));
    require('child_process').exec('python3 ' + JSON.stringify(pyScript), function(err) {
      try { require('fs').unlinkSync(pyScript); } catch(e) {}
      try { require('fs').unlinkSync(htmlPath); } catch(e) {}
      if (err) reject(new Error('WeasyPrint: ' + err.message));
      else resolve(pdfPath);
    });
  });
}

// ── WhatsApp события ────────────────────────────────────────────────────────
client.on('qr', function(qr) {
  currentQR = qr;
  botState = 'qr';
  console.log('\n📱 QR готов! Открой: http://localhost:3000');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async function() {
  currentQR = null;
  botState = 'connected';
  statsCount = 0;
  try {
    var info = client.info;
    connectedPhone = info && info.wid ? info.wid.user : '';
    console.log('✅ Бот запущен! Номер: ' + connectedPhone);
    console.log('🔑 Кодовое слово: "' + KEYWORD_DYNAMIC + '"');
    console.log('🌐 Панель: http://localhost:3000');
  } catch(e) { console.log('✅ Бот запущен!'); }
});

client.on('disconnected', function() {
  botState = 'disconnected';
  connectedPhone = '';
  console.log('🔌 WhatsApp отключён');
});

// ── Обработка сообщений ────────────────────────────────────────────────────
async function handleMessage(msg) {
  if (!msg.body) return;
  if (!msg.body.toLowerCase().trim().includes(KEYWORD_DYNAMIC.toLowerCase())) return;

  var chat = await msg.getChat();
  console.log('\n🎯 Кодовое слово в чате: ' + chat.name);

  try {
    await chat.sendMessage('⏳ Анализирую переписку и генерирую декларацию...');

    var messages = await chat.fetchMessages({ limit: MSG_LIMIT });
    var chatText = messages
      .filter(function(m) { return m.body && !m.body.toLowerCase().includes(KEYWORD_DYNAMIC.toLowerCase()); })
      .map(function(m) {
        var who = m.fromMe ? 'Менеджер' : (chat.name || 'Клиент');
        return who + ': ' + m.body;
      })
      .join('\n')
      .slice(0, 2000);

    console.log('📝 Анализирую переписку...');

    // Ищем фото инвойса
    var invoiceData = null;
    for (var mi = messages.length - 1; mi >= 0; mi--) {
      var m = messages[mi];
      if (m.hasMedia && m.type === 'image') {
        try {
          console.log('🖼️ Найдено фото, распознаю инвойс...');
          var media = await m.downloadMedia();
          if (media && media.data) {
            invoiceData = await recognizeInvoice(media.data, media.mimetype);
            console.log('✅ Инвойс распознан');
          }
          break;
        } catch(e) { console.log('⚠️ Ошибка фото:', e.message); }
      }
    }

    var data = await analyzeChat(chatText, invoiceData);
    console.log('✅ Данные извлечены');

    // Курс НБРК автоматически
    if (!data.exchange_rate || data.exchange_rate === '0') {
      console.log('💱 Получаю курс НБРК...');
      var rate = await getExchangeRate(data.currency || 'USD');
      if (rate) { data.exchange_rate = rate; console.log('✅ Курс: ' + rate); }
    }

    // Проверка ТН ВЭД
    var tnvedWarnings = [];
    for (var gi = 0; gi < (data.goods || []).length; gi++) {
      var good = data.goods[gi];
      if (good.tnved && good.tnved.length >= 4) {
        var check = await checkTnved(good.tnved, good.name);
        if (check && check.correct === false) {
          tnvedWarnings.push('⚠️ Товар ' + (gi+1) + ' "' + good.name + '": код ' + good.tnved + ' — ' + (check.reason||'возможно неверный') + '. Рекомендуется: ' + (check.suggestion||'?'));
          if (check.suggestion) good.tnved = check.suggestion;
        }
      }
    }
    if (tnvedWarnings.length > 0) {
      await msg.reply('🔍 *Проверка ТН ВЭД:*\n\n' + tnvedWarnings.join('\n'));
    }

    // Строгая проверка — если не хватает обязательных полей, СТОП
    var missingRequired = [];
    var missingOptional = [];

    // Обязательные поля — без них декларация невозможна
    if (!data.declarant_name) missingRequired.push('название компании или ФИО декларанта');
    if (!data.declarant_inn) missingRequired.push('БИН / ИИН');
    if (!data.exporter_name) missingRequired.push('название компании отправителя');
    if (!data.exporter_country) missingRequired.push('страна отправления');
    if (!data.currency) missingRequired.push('валюта (USD/EUR/CNY)');
    if (!data.total_invoice_amount) missingRequired.push('общая сумма по инвойсу');
    if (!data.goods || data.goods.length === 0) missingRequired.push('список товаров');
    if (data.goods) {
      data.goods.forEach(function(g, i) {
        if (!g.name) missingRequired.push('наименование товара ' + (i+1));
        if (!g.total_price) missingRequired.push('цена товара ' + (i+1));
      });
    }

    // Желательные поля — предупреждаем но не останавливаем
    if (!data.declarant_address) missingOptional.push('адрес декларанта');
    if (!data.delivery_terms) missingOptional.push('условия поставки (CIP/FOB/EXW)');
    if (!data.transport_id) missingOptional.push('номер контейнера');
    if (!data.border_crossing) missingOptional.push('таможенный пост');
    if (!data.gross_weight) missingOptional.push('общий вес брутто (кг)');
    if (!data.invoice_number) missingOptional.push('номер инвойса');
    if (!data.contract_number) missingOptional.push('номер контракта');
    if (!data.packages_count) missingOptional.push('количество мест');
    if (data.goods) {
      data.goods.forEach(function(g, i) {
        if (!g.gross_weight) missingOptional.push('вес товара ' + (i+1) + ' (' + (g.name||'?') + ')');
        if (!g.quantity) missingOptional.push('количество товара ' + (i+1) + ' (' + (g.name||'?') + ')');
      });
    }

    // Если не хватает обязательных — СТОП, просим клиента
    if (missingRequired.length > 0) {
      var stopMsg = '❌ *Недостаточно данных для создания декларации*\n\n';
      stopMsg += 'Для оформления декларации необходимо уточнить у клиента:\n\n';
      missingRequired.forEach(function(m) { stopMsg += '🔴 ' + m + '\n'; });
      if (missingOptional.length > 0) {
        stopMsg += '\nТакже желательно уточнить:\n';
        missingOptional.forEach(function(m) { stopMsg += '🟡 ' + m + '\n'; });
      }
      stopMsg += '\n_Декларация не создана. После получения данных напишите кодовое слово снова._';
      await chat.sendMessage(stopMsg);
      console.log('⛔ Остановлено — не хватает обязательных данных:', missingRequired);
      return;
    }

    // Если не хватает только желательных — предупреждаем и продолжаем
    if (missingOptional.length > 0) {
      var warnMsg = '⚠️ *Некоторые данные отсутствуют — декларация будет создана частично*\n\n';
      warnMsg += 'Не указано:\n';
      missingOptional.forEach(function(m) { warnMsg += '🟡 ' + m + '\n'; });
      warnMsg += '\n_Рекомендуем уточнить эти данные и при необходимости отредактировать декларацию._';
      await chat.sendMessage(warnMsg);
    }

    console.log('📄 Генерирую PDF...');
    var pdfPath = await generateDTPDF(data);
    console.log('✅ PDF создан');

    var media2 = MessageMedia.fromFilePath(pdfPath);
    await chat.sendMessage(media2, { caption: '📋 Декларация на товары (ДТ) готова.\n⚠️ Проверьте данные перед подачей.' });

    // Автосохранение
    var clientName = (data.declarant_name || chat.name || 'unknown').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_').slice(0, 40);
    var dateStr = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    var saveDir = path.join(__dirname, 'declarations', clientName + '_' + dateStr);
    if (!fs.existsSync(path.join(__dirname, 'declarations'))) fs.mkdirSync(path.join(__dirname, 'declarations'));
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
    var savePath = path.join(saveDir, 'declaration_' + Date.now() + '.pdf');
    fs.copyFileSync(pdfPath, savePath);
    fs.writeFileSync(savePath.replace('.pdf', '_data.json'), JSON.stringify(data, null, 2));
    fs.unlinkSync(pdfPath);
    statsCount++;
    console.log('💾 Сохранено: ' + savePath);
    console.log('✅ PDF отправлен!');

  } catch(err) {
    console.error('❌ Ошибка:', err.message);
    await chat.sendMessage('❌ Ошибка генерации декларации: ' + err.message);
  }
}

client.on('message', handleMessage);
client.on('message_create', handleMessage);


client.initialize();
