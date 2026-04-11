// Field questions for conversational flow
const FIELD_QUESTIONS = [
    { field: 'contract_number',      q: '📋 Номер контракта?' },
    { field: 'gross_weight',         q: '⚖️ Вес брутто (кг)?' },
];

// Kill any existing bot processes to prevent Telegram 409 conflict
const { execSync } = require('child_process');
try {
  execSync('pkill -f "node bot.js"', { stdio: 'inherit' });
  console.log('🧹 Killed existing bot processes');
} catch(e) {
  // No existing processes to kill, that's fine
}

// Load enhanced parser with "Field: Value" format support
const { parseEnhancedFormData, analyzeMissingData } = require('./enhanced_parser.js');
const { generateDeclarationMessage, enrichGoodsWithOfficialTnved } = require('./CoreEngine.js');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const AUTH_DIR = path.join(__dirname, process.env.AUTH_DIR || 'whatsapp-auth');
const DECLARATIONS_DIR = path.resolve(process.env.DECLARATIONS_DIR || path.join(DATA_DIR, 'declarations'));
const SETTINGS_FILE = path.resolve(process.env.SETTINGS_FILE || path.join(DATA_DIR, 'settings.json'));
const KEDEN_TNVED_URL = process.env.KEDEN_TNVED_URL || 'https://keden.kz/tnved';
const WHATSAPP_CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || 'customsai';
const WHATSAPP_SESSION_DIR = path.join(AUTH_DIR, 'session-' + WHATSAPP_CLIENT_ID);

// Telegram chat history storage
const TELEGRAM_CHAT_HISTORY_FILE = path.join(DATA_DIR, 'telegram_chat_history.json');
var telegramChatHistory = new Map(); // chatId -> array of messages

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function removePathIfExists(targetPath) {
  try {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
  } catch(e) {
    console.log('⚠️ Не удалось удалить stale lock: ' + targetPath + ' — ' + e.message);
  }
}

function cleanupChromeSingletonLocks(rootDir) {
  if (!fs.existsSync(rootDir)) return;

  var entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch(e) {
    console.log('⚠️ Не удалось прочитать auth dir для cleanup: ' + e.message);
    return;
  }

  entries.forEach(function(entry) {
    var fullPath = path.join(rootDir, entry.name);

    if (entry.name === 'SingletonLock' || entry.name === 'SingletonSocket' || entry.name === 'SingletonCookie') {
      console.log('🧹 Удаляю stale Chromium lock: ' + fullPath);
      removePathIfExists(fullPath);
      return;
    }

    if (entry.isDirectory()) cleanupChromeSingletonLocks(fullPath);
  });
}

function getPanelUrl(port) {
  if (process.env.PUBLIC_PANEL_URL) return process.env.PUBLIC_PANEL_URL;
  if (process.env.RAILWAY_STATIC_URL) return 'https://' + process.env.RAILWAY_STATIC_URL;
  return 'http://localhost:' + port;
}

ensureDirSync(DATA_DIR);
ensureDirSync(AUTH_DIR);
ensureDirSync(DECLARATIONS_DIR);
cleanupChromeSingletonLocks(AUTH_DIR);
cleanupChromeSingletonLocks(WHATSAPP_SESSION_DIR);

// Auto-detect Chrome path (Mac or Linux)
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/chromium');

const PANEL_PORT = parseInt(process.env.PORT || '3000', 10);
const PANEL_URL = getPanelUrl(PANEL_PORT);

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: AUTH_DIR,
    clientId: WHATSAPP_CLIENT_ID
  }),
  puppeteer: {
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  },
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  qrMaxRetries: 5
});

// ── Веб-сервер — панель управления ───────────────────────────────────────
var currentQR = null;
var botState = 'disconnected';
var connectedPhone = '';
var KEYWORD = 'декларация 777';
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

// Telegram bot token
var TELEGRAM_TOKEN = '8688934296:AAEakzi11A0jHq3GHOlprJhronx5jTAPlyU';
var telegramBot = null; // Will be initialized later

// Conversation state tracking
var conversationStates = new Map(); // chatId -> state

// WhatsApp chat history persistence
var CHAT_HISTORY_FILE = path.join(DATA_DIR, 'whatsapp_chat_history.json');
var chatHistory = new Map(); // chatId -> array of messages

function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
      var data = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
      chatHistory = new Map(Object.entries(data));
      console.log('📚 Загружена история чатов: ' + chatHistory.size + ' чатов');
    }
  } catch(e) {
    console.log('⚠️ Не удалось загрузить историю чатов:', e.message);
    chatHistory = new Map();
  }
}

function saveChatHistory() {
  try {
    var data = Object.fromEntries(chatHistory);
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    console.log('⚠️ Не удалось сохранить историю чатов:', e.message);
  }
}

function addMessageToHistory(chatId, message) {
  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, []);
  }
  var history = chatHistory.get(chatId);
  history.push({
    body: message.body,
    fromMe: message.fromMe,
    timestamp: Date.now(),
    type: message.type || 'text',
    hasMedia: message.hasMedia || false
  });
  // Keep only last 200 messages per chat
  if (history.length > 200) {
    history = history.slice(-200);
    chatHistory.set(chatId, history);
  }
  // Save periodically (every 10 messages)
  if (history.length % 10 === 0) {
    saveChatHistory();
  }
}

function getFullChatHistory(chatId, recentMessages) {
  var saved = chatHistory.get(chatId) || [];
  // Combine with recent messages from current session
  var combined = saved.slice();
  // Add recent messages if not already in history
  recentMessages.forEach(function(msg) {
    var exists = combined.some(function(h) {
      return h.body === msg.body && Math.abs(h.timestamp - Date.now()) < 5000;
    });
    if (!exists) {
      combined.push({
        body: msg.body,
        fromMe: msg.fromMe,
        timestamp: Date.now(),
        type: msg.type || 'text',
        hasMedia: msg.hasMedia || false
      });
    }
  });
  return combined;
}

// Telegram chat history functions
function loadTelegramChatHistory() {
  try {
    if (fs.existsSync(TELEGRAM_CHAT_HISTORY_FILE)) {
      var data = JSON.parse(fs.readFileSync(TELEGRAM_CHAT_HISTORY_FILE, 'utf8'));
      telegramChatHistory = new Map(Object.entries(data));
      console.log('Telegram history loaded for ' + telegramChatHistory.size + ' chats');
    }
  } catch(e) {
    console.log('Error loading Telegram history:', e.message);
    telegramChatHistory = new Map();
  }
}

function saveTelegramChatHistory() {
  try {
    var data = Object.fromEntries(telegramChatHistory);
    fs.writeFileSync(TELEGRAM_CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    console.log('Error saving Telegram history:', e.message);
  }
}

function addTelegramMessage(chatId, text) {
  if (!telegramChatHistory.has(chatId)) {
    telegramChatHistory.set(chatId, []);
  }
  
  var messages = telegramChatHistory.get(chatId);
  messages.push({
    text: text,
    timestamp: Date.now(),
    fromUser: true
  });
  
  // Keep only last 100 messages
  if (messages.length > 100) {
    messages = messages.slice(-100);
    telegramChatHistory.set(chatId, messages);
  }
  
  saveTelegramChatHistory();
}

// WhatsApp chat history functions
var whatsappChatHistory = new Map();
var WHATSAPP_CHAT_HISTORY_FILE = path.join(__dirname, 'whatsapp_chat_history.json');

function loadWhatsAppChatHistory() {
  try {
    if (fs.existsSync(WHATSAPP_CHAT_HISTORY_FILE)) {
      var data = JSON.parse(fs.readFileSync(WHATSAPP_CHAT_HISTORY_FILE, 'utf8'));
      whatsappChatHistory = new Map(Object.entries(data));
      console.log('WhatsApp history loaded for ' + whatsappChatHistory.size + ' chats');
    }
  } catch(e) {
    console.log('Error loading WhatsApp history:', e.message);
    whatsappChatHistory = new Map();
  }
}

function saveWhatsAppChatHistory() {
  try {
    var data = Object.fromEntries(whatsappChatHistory);
    fs.writeFileSync(WHATSAPP_CHAT_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch(e) {
    console.log('Error saving WhatsApp history:', e.message);
  }
}

function addWhatsAppMessage(chatId, text) {
  if (!whatsappChatHistory.has(chatId)) {
    whatsappChatHistory.set(chatId, []);
  }

  var messages = whatsappChatHistory.get(chatId);
  messages.push({
    text: text,
    timestamp: Date.now(),
    fromUser: true
  });

  // Keep only last 100 messages
  if (messages.length > 100) {
    messages = messages.slice(-100);
    whatsappChatHistory.set(chatId, messages);
  }

  saveWhatsAppChatHistory();
}

function analyzeWhatsAppChatHistory(chatId) {
  var messages = whatsappChatHistory.get(chatId) || [];
  if (messages.length === 0) return {};

  // Combine all messages into one text for analysis
  var combinedText = messages
    .map(function(msg) { return msg.text; })
    .join('\n')
    .slice(0, 8000); // Limit context size

  console.log('Analyzing WhatsApp history: ' + messages.length + ' messages');

  try {
    var result = parseEnhancedFormData(combinedText);
    return result.data || result;
  } catch(e) {
    console.log('Error analyzing WhatsApp history:', e.message);
    return {};
  }
}

function analyzeTelegramChatHistory(chatId) {
  var messages = telegramChatHistory.get(chatId) || [];
  if (messages.length === 0) return {};
  
  // Combine all messages into one text for analysis
  var combinedText = messages
    .map(function(msg) { return msg.text; })
    .join('\n')
    .slice(0, 8000); // Limit context size
  
  console.log('Analyzing Telegram history: ' + messages.length + ' messages');
  
  try {
    var result = parseEnhancedFormData(combinedText);
    return result.data || result;
  } catch(e) {
    console.log('Error analyzing Telegram history:', e.message);
    return {};
  }
}

// Load history on startup
loadChatHistory();
loadTelegramChatHistory();
loadWhatsAppChatHistory();

var webServer = http.createServer(function(req, res) {
  var url = req.url.split('?')[0];

  // Add ngrok bypass header to all responses
  res.setHeader('ngrok-skip-browser-warning', 'true');
  
  // Add CORS headers to allow cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getPanelHTML());

  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      state: botState,
      phone: connectedPhone,
      data_dir: DATA_DIR,
      declarations_dir: DECLARATIONS_DIR
    }));

  } else if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      state: botState,
      phone: connectedPhone,
      keyword: KEYWORD_DYNAMIC,
      stats: statsCount,
      msg_limit: MSG_LIMIT,
      hasQR: currentQR ? true : false,
      telegram_enabled: true,
      telegram_connected: true
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

  } else if (url === '/set-telegram-token' && req.method === 'POST') {
    var body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (data.token && data.token.trim().length > 0) {
          // TODO: Initialize Telegram bot with token
          console.log('📱 Telegram токен получен: ' + data.token.trim().substring(0, 10) + '...');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Токен сохранен' }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Токен обязателен' }));
        }
      } catch(e) { 
        console.log('❌ Ошибка парсинга JSON:', e.message);
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); 
      }
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

        await enrichGoodsWithOfficialTnved(parsed.goods || []);

        var manualValidation = validateDeclarationData(parsed);
        if (!manualValidation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: 'Не хватает обязательных данных',
            missing_required: manualValidation.required,
            missing_optional: manualValidation.optional,
            data: parsed
          }));
          return;
        }

        var pdfPath = await generateDTPDF(parsed);
        var pdfData = fs.readFileSync(pdfPath);

        var clientName = (parsed.declarant_name || 'manual').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_').slice(0, 40);
        var dateStr = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
        var saveDir = path.join(DECLARATIONS_DIR, clientName + '_' + dateStr);
        ensureDirSync(DECLARATIONS_DIR);
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
        await enrichGoodsWithOfficialTnved(parsed.goods || []);
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
        await enrichGoodsWithOfficialTnved(data.goods || []);

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
        var saveDir = path.join(DECLARATIONS_DIR, clientName + '_' + dateStr);
        ensureDirSync(DECLARATIONS_DIR);
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

        var resolution = await resolveOfficialTnved({
          name: goodsName,
          material: material,
          tnved: data.code || ''
        });

        if (!resolution.candidates || resolution.candidates.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Товар не найден на keden.kz. Попробуйте другое название.' }));
          return;
        }

        var result = {
          status: resolution.status,
          code: resolution.code,
          description: resolution.description,
          duty_rate: '',
          vat: '12%',
          reason: resolution.reason,
          confidence: resolution.status === 'confirmed' ? 'high' : 'manual_confirmation_required',
          source: 'keden.kz',
          all_results: resolution.candidates
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
      filePath = path.join(DECLARATIONS_DIR, parts[0], parts[1]);
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
        await enrichGoodsWithOfficialTnved(data.goods || []);

        var regenerateValidation = validateDeclarationData(data);
        if (!regenerateValidation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Не хватает обязательных данных',
            missing_required: regenerateValidation.required,
            missing_optional: regenerateValidation.optional
          }));
          return;
        }

        var pdfPath = await generateDTPDF(data);
        var pdfData = fs.readFileSync(pdfPath);

        // Overwrite original if path known
        if (origPdfPath && origPdfPath.startsWith('/dl/')) {
          var parts = origPdfPath.replace('/dl/', '').split('/');
          var realPath = path.join(DECLARATIONS_DIR, parts[0], parts[1]);
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
    var dir = DECLARATIONS_DIR;
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
    var jsonPath = path.join(DECLARATIONS_DIR, folder.split('/')[0], folder.split('/')[1].replace('.pdf', '_data.json'));
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
        await enrichGoodsWithOfficialTnved(data.goods || []);

        var regenerateValidation2 = validateDeclarationData(data);
        if (!regenerateValidation2.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Не хватает обязательных данных',
            missing_required: regenerateValidation2.required,
            missing_optional: regenerateValidation2.optional
          }));
          return;
        }

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
    var filePath = path.join(DECLARATIONS_DIR, parts[0], parts[1]);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      fs.createReadStream(filePath).pipe(res);
    } else { res.writeHead(404); res.end(); }

  } else {
    res.writeHead(404); res.end();
  }
});

webServer.on('error', function(err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('❌ Порт ' + PANEL_PORT + ' уже занят. Закройте другое приложение на этом порту или запустите бот так: PORT=3001 npm start');
    return;
  }
  console.error('❌ Ошибка веб-панели:', err.message);
});

webServer.listen(PANEL_PORT, function() {
  console.log('🌐 Панель управления: ' + PANEL_URL);
});

function getPanelHTML() {
  try {
    return require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
  } catch(e) {
    return '<h1>index.html not found</h1>';
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
      if (!g.tnved && !g.tnved_code) optional.push('код ТН ВЭД товара ' + (i+1) + ' требует ручной проверки');
      if ((g.tnved || g.tnved_code) && g.tnved_status && g.tnved_status !== 'confirmed' && g.tnved_status !== 'success') {
        optional.push('код ТН ВЭД товара ' + (i+1) + ' требует уточнения');
      }
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
// Теперь используем exchangerate-api.com - официальный API с реальными курсами
function getExchangeRate(currency) {
  return new Promise(async function(resolve) {
    var cur = (currency || 'USD').toUpperCase();
    console.log('🔍 getExchangeRate called for: ' + cur);
    
    // Если валюта уже в тенге (KZT), курс = 1
    if (cur === 'KZT') {
      console.log('💱 Валюта KZT, курс = 1.00');
      resolve('1.00');
      return;
    }
    
    // Используем exchangerate-api.com - официальный API
    var url = 'https://open.er-api.com/v6/latest/' + cur;
    console.log('💱 Запрос к exchangerate-api.com: ' + url);
    
    try {
      var https = require('https');
      var rate = await new Promise(function(resolveReq, rejectReq) {
        var req = https.get(url, { rejectUnauthorized: false, timeout: 15000 }, function(res) {
          var data = '';
          res.on('data', function(chunk) { data += chunk; });
          res.on('end', function() {
            console.log('📄 Получено данных: ' + data.length + ' байт');
            try {
              var json = JSON.parse(data);
              if (json && json.result === 'success' && json.rates && json.rates.KZT) {
                var rateValue = parseFloat(json.rates.KZT).toFixed(2);
                console.log('✅ Курс ' + cur + '/KZT найден: ' + rateValue);
                console.log('📅 Последнее обновление: ' + json.time_last_update_utc);
                resolveReq(rateValue);
              } else {
                console.log('⚠️ Курс KZT не найден в ответе');
                console.log('📄 Ответ: ' + data.substring(0, 200));
                rejectReq(new Error('KZT rate not found'));
              }
            } catch(e) {
              console.log('❌ Ошибка парсинга JSON: ' + e.message);
              rejectReq(e);
            }
          });
        });
        req.on('error', function(e) { 
          console.log('❌ Ошибка запроса: ' + e.message);
          rejectReq(e); 
        });
        req.setTimeout(15000, function() { 
          console.log('⏰ Таймаут запроса');
          req.destroy(); 
          rejectReq(new Error('timeout')); 
        });
      });
      
      if (rate && parseFloat(rate) > 1) {
        resolve(rate);
        return;
      }
    } catch(e) {
      console.log('❌ Ошибка получения курса: ' + e.message);
    }
    
    // Fallback на Нацбанк если exchangerate-api не сработал
    console.log('⚠️ Пробуем fallback на Нацбанк...');
    try {
      var https = require('https');
      var rate = await new Promise(function(resolveReq, rejectReq) {
        var req = https.get('https://nationalbank.kz/rss/rates_all.xml', { rejectUnauthorized: false, timeout: 10000 }, function(res) {
          var data = '';
          res.on('data', function(chunk) { data += chunk; });
          res.on('end', function() {
            var pattern = new RegExp('<title>' + cur + '<\/title>[\\s\\S]*?<description>([\\d\\.]+)<\/description>', 'i');
            var match = data.match(pattern);
            if (match) {
              var rateValue = parseFloat(match[1]).toFixed(2);
              console.log('✅ Курс ' + cur + ' от Нацбанка: ' + rateValue);
              resolveReq(rateValue);
            } else {
              rejectReq(new Error('Rate not found'));
            }
          });
        });
        req.on('error', function(e) { rejectReq(e); });
        req.setTimeout(10000, function() { req.destroy(); rejectReq(new Error('timeout')); });
      });
      
      if (rate && parseFloat(rate) > 1) {
        resolve(rate);
        return;
      }
    } catch(e) {
      console.log('❌ Fallback Нацбанк тоже не сработал: ' + e.message);
    }
    
    console.log('❌ Не удалось получить курс ' + cur);
    resolve(''); // Вернем пустую строку
  });
}

// ── Официальная верификация ТН ВЭД через keden.kz ─────────────────────────
function sanitizeTnvedCode(value) {
  return (value || '').toString().replace(/\D/g, '').slice(0, 10);
}

function normalizeSearchText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"'«»№?+[\]\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQueryWords(goodsName, material) {
  var text = normalizeSearchText((goodsName || '') + ' ' + (material || ''));
  return text.split(' ').filter(function(word) {
    return word.length >= 3;
  });
}

function scoreKedenResult(result, queryWords) {
  var description = normalizeSearchText(result && result.description);
  var matchedWords = queryWords.filter(function(word) {
    return description.indexOf(word) >= 0;
  });
  return {
    matchedWords: matchedWords,
    coverage: queryWords.length ? (matchedWords.length / queryWords.length) : 0
  };
}

function buildKedenSearchQuery(goodsName, material) {
  return [goodsName || '', material || ''].join(' ').replace(/\s+/g, ' ').trim();
}

function formatKedenCandidates(results) {
  return (results || []).slice(0, 5).map(function(item, index) {
    return (index + 1) + '. ' + item.code + ' — ' + item.description;
  });
}

function applyTnvedResolution(good, resolution) {
  good.tnved = resolution.code || '';
  good.tnved_description = resolution.description || '';
  good.tnved_source = resolution.source || '';
  good.tnved_status = resolution.status || '';
  good.tnved_reason = resolution.reason || '';
  good.tnved_candidates = resolution.candidates || [];
  return good;
}

async function enrichGoodsWithOfficialTnvedOld(goods) {
  for (var i = 0; i < (goods || []).length; i++) {
    applyTnvedResolution(goods[i], await resolveOfficialTnved(goods[i]));
  }
}

async function resolveOfficialTnved(good) {
  var goodsName = (good && good.name) || '';
  var material = (good && good.material) || '';
  var providedCode = sanitizeTnvedCode(good && good.tnved);
  var query = buildKedenSearchQuery(goodsName, material);

  if (!query) {
    return {
      code: '',
      description: '',
      source: '',
      status: 'missing_query',
      reason: 'Нет названия товара для поиска на keden.kz',
      candidates: []
    };
  }

  console.log('🔍 Проверяю ТН ВЭД по keden.kz: ' + query);
  var results = await searchKeden(query);
  var queryWords = getQueryWords(goodsName, material);

  if (!results.length) {
    return {
      code: '',
      description: '',
      source: 'keden.kz',
      status: 'not_found',
      reason: 'На keden.kz не найдено совпадений по запросу',
      candidates: []
    };
  }

  if (providedCode) {
    var providedMatch = results.find(function(item) { return item.code === providedCode; });
    if (providedMatch) {
      return {
        code: providedMatch.code,
        description: providedMatch.description,
        source: 'keden.kz',
        status: 'confirmed',
        reason: 'Код подтвержден официальным поиском на keden.kz',
        candidates: results
      };
    }
  }

  if (results.length === 1) {
    var singleScore = scoreKedenResult(results[0], queryWords);
    if (!queryWords.length || singleScore.coverage === 1) {
      return {
        code: results[0].code,
        description: results[0].description,
        source: 'keden.kz',
        status: 'confirmed',
        reason: 'Найдено единственное официальное совпадение на keden.kz',
        candidates: results
      };
    }
  }

  return {
    code: '',
    description: '',
    source: 'keden.kz',
    status: 'needs_manual_confirmation',
    reason: 'По запросу найдено несколько вариантов. Для точности код нужно выбрать вручную из результатов keden.kz.',
    candidates: results
  };
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
  // First, try to parse using our enhanced parser for "Field: Value" format
  console.log('🔍 Trying enhanced parser for "Field: Value" format...');
  var enhancedData = parseEnhancedFormData(chatText);
  
  // Check if we got meaningful data from enhanced parser
  var hasEnhancedData = enhancedData.declarant_name || 
                        enhancedData.exporter_name || 
                        enhancedData.total_invoice_amount ||
                        (enhancedData.goods && enhancedData.goods.length > 0 && enhancedData.goods[0].name);
  
  if (hasEnhancedData) {
    console.log('✅ Enhanced parser found data, merging with AI analysis...');
    console.log('📋 Declarant:', enhancedData.declarant_name || 'N/A');
    console.log('📋 Exporter:', enhancedData.exporter_name || 'N/A');
    console.log('📋 Goods count:', enhancedData.goods ? enhancedData.goods.length : 0);
  }

  var invoiceContext = invoiceData ? '\n\nADDITIONAL DATA FROM INVOICE PHOTO: ' + JSON.stringify(invoiceData) : '';
  var prompt = 'You are a Kazakhstan customs expert. Extract data from this WhatsApp chat for a customs Declaration on Goods (DT). Return ONLY raw JSON, nothing else.\n\nCRITICAL RULES:\n- NEVER invent, guess or fill in missing data\n- If a field is not explicitly mentioned in the chat, leave it as empty string ""\n- Only extract what is clearly stated\n- For goods: extract material/composition if mentioned (cotton, aluminum, plastic, steel)\n- Do NOT make up TNVED codes, weights, prices or any numbers not in the chat\n\nIMPORTANT RULES:\n- Extract ALL goods mentioned, do not skip any\n- currency must be exactly as mentioned (USD, EUR, etc) - do NOT convert\n- total_invoice_amount is the invoice total in the original currency\n- exchange_rate is KZT rate (e.g. 492.30)\n- gross_weight is in kg\n- packages_count is the number of packages/boxes/bottles (e.g. "60 бочек" -> 60)\n- For each good: total_price is price in original currency\n\nUNIT DETECTION RULES:\n- If user writes "кг", "kg", "килограмм", use unit="кг"\n- If user writes "шт", "штука", "piece", "pcs", use unit="шт"\n- If user writes "м", "метр", use unit="м"\n- If user writes "л", "литр", use unit="л"\n- If no unit is mentioned, use unit="" (empty string)\n- ALWAYS extract the unit exactly as written by the user, do NOT guess\n\nPACKAGES COUNT RULES:\n- Extract packages_count from phrases like "60 бочек", "15 паллет", "10 ящиков"\n- Extract only the number (e.g. "60 бочек" -> 60)\n- This is for Field 6 "Всего мест"\n\nCHAT:\n' + chatText + '\n\nReturn ONLY this JSON structure:\n{"declarant_name":"","declarant_inn":"","declarant_address":"","exporter_name":"","exporter_country":"","exporter_address":"","delivery_terms":"","currency":"USD","total_invoice_amount":"","exchange_rate":"","transport_type":"20","transport_id":"","border_crossing":"","gross_weight":"","packages_count":"","invoice_number":"","invoice_date":"","contract_number":"","goods":[{"name":"","tnved":"","origin_country":"CN","gross_weight":"","net_weight":"","quantity":"","unit":"","total_price":"","customs_procedure":"4000"}]}\n\nExtract every single product mentioned. Empty string if not found.';

  var text = await callNvidia(prompt);
  text = text.replace(/```json|```/g, '').trim();
  var match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  var aiData = JSON.parse(text);

  // Merge enhanced parser data with AI data (enhanced takes priority for non-empty fields)
  var mergedData = { ...aiData };
  
  if (hasEnhancedData) {
    // Override with enhanced parser data where available
    if (enhancedData.declarant_name) mergedData.declarant_name = enhancedData.declarant_name;
    if (enhancedData.declarant_inn) mergedData.declarant_inn = enhancedData.declarant_inn;
    if (enhancedData.declarant_address) mergedData.declarant_address = enhancedData.declarant_address;
    if (enhancedData.exporter_name) mergedData.exporter_name = enhancedData.exporter_name;
    if (enhancedData.exporter_country) mergedData.exporter_country = enhancedData.exporter_country;
    if (enhancedData.exporter_address) mergedData.exporter_address = enhancedData.exporter_address;
    if (enhancedData.currency) mergedData.currency = enhancedData.currency;
    if (enhancedData.total_invoice_amount) mergedData.total_invoice_amount = enhancedData.total_invoice_amount;
    if (enhancedData.delivery_terms) mergedData.delivery_terms = enhancedData.delivery_terms;
    if (enhancedData.invoice_number) mergedData.invoice_number = enhancedData.invoice_number;
    if (enhancedData.contract_number) mergedData.contract_number = enhancedData.contract_number;
    if (enhancedData.transport_id) mergedData.transport_id = enhancedData.transport_id;
    if (enhancedData.border_crossing) mergedData.border_crossing = enhancedData.border_crossing;
    if (enhancedData.gross_weight) mergedData.gross_weight = enhancedData.gross_weight;
    if (enhancedData.packages_count) mergedData.packages_count = enhancedData.packages_count;
    if (enhancedData.net_weight) mergedData.net_weight = enhancedData.net_weight;

    // STRICT MAPPING: Set IMMUTABLE flags immediately after merge to prevent AI override
    if (enhancedData.gross_weight) {
      mergedData.IMMUTABLE_GROSS_WEIGHT = enhancedData.gross_weight;
      console.log('✅ [STRICT MAPPING] gross_weight set to IMMUTABLE in merge: ' + mergedData.IMMUTABLE_GROSS_WEIGHT);
    }
    if (enhancedData.packages_count) {
      mergedData.IMMUTABLE_PACKAGES_COUNT = enhancedData.packages_count;
      console.log('✅ [STRICT MAPPING] packages_count set to IMMUTABLE in merge: ' + mergedData.IMMUTABLE_PACKAGES_COUNT);
    }
    if (enhancedData.net_weight) {
      mergedData.IMMUTABLE_NET_WEIGHT = enhancedData.net_weight;
      console.log('✅ [STRICT MAPPING] net_weight set to IMMUTABLE in merge: ' + mergedData.IMMUTABLE_NET_WEIGHT);
    }

    // Merge goods - use enhanced parser goods if we have them with names
    if (enhancedData.goods && enhancedData.goods.length > 0 && enhancedData.goods[0].name) {
      mergedData.goods = enhancedData.goods;
      console.log('✅ Using goods from enhanced parser');
    }
  }

  await enrichGoodsWithOfficialTnved(mergedData.goods || []);

  return mergedData;
}

// ── Определение ТН ВЭД ────────────────────────────────────────────────────
// ── Поиск ТН ВЭД через keden.kz ───────────────────────────────────────────
async function searchKeden(query) {
  var puppeteer = require('puppeteer');
  var browser = null;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
      });
      var page = await browser.newPage();
      await page.setDefaultNavigationTimeout(60000);
      await page.setDefaultTimeout(30000);
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(KEDEN_TNVED_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(function() { return document.readyState === 'complete'; }, { timeout: 15000 }).catch(function() {});
      await new Promise(function(r) { setTimeout(r, 5000); });

      var searchInput = await page.$('input[type="search"]') ||
                        await page.$('input[placeholder*="оиск"]') ||
                        await page.$('input[placeholder*="овар"]') ||
                        await page.$('.ant-input') ||
                        await page.$('input');

      if (!searchInput) throw new Error('Search input not found');

      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await searchInput.type(query, { delay: 80 });
      await page.keyboard.press('Enter');
      await new Promise(function(r) { setTimeout(r, 5000); });

      var results = await page.evaluate(function() {
        var extracted = [];
        var seen = {};
        Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function(el) {
          var text = (el.innerText || '').trim();
          if (!/^\d{10}/.test(text) || el.children.length >= 8) return;
          var codeMatch = text.match(/^(\d{10})/);
          if (!codeMatch) return;
          var code = codeMatch[1];
          var description = text.replace(code, '').trim();
          if (description.length < 4 || seen[code]) return;
          seen[code] = true;
          extracted.push({ code: code, description: description.slice(0, 500) });
        });
        return extracted.slice(0, 10);
      });

      await browser.close();
      browser = null;
      console.log('🌐 Keden: найдено ' + results.length + ' результатов для "' + query + '"');
      results.forEach(function(item, index) {
        console.log('  ' + (index + 1) + '. ' + item.code + ' — ' + item.description.slice(0, 80));
      });
      return results;
    } catch(e) {
      if (browser) {
        try { await browser.close(); } catch(e2) {}
        browser = null;
      }
      console.log('⚠️ Попытка ' + attempt + '/3 поиска на keden.kz не удалась: ' + e.message.slice(0, 120));
      if (attempt === 3) {
        console.log('⚠️ Keden недоступен после 3 попыток');
        return [];
      }
      await new Promise(function(resolve) { setTimeout(resolve, attempt * 2000); });
    }
  }
}

// ── Генерация PDF (ДТ форма) ───────────────────────────────────────────────
function generateDTPDF(data) {
  // COMPREHENSIVE VALIDATION before generating PDF

  // OUTPUT VARIABLE VALUES BEFORE PDF GENERATION (as requested by user)
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 PDF GENERATION - VARIABLE VALUES BEFORE CREATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 [FIELD 6 - Total Packages] packages_count: "' + (data.packages_count || 'EMPTY') + '"');
  console.log('🔍 [FIELD 35 - Gross Weight] gross_weight: "' + (data.gross_weight || 'EMPTY') + '" kg');
  console.log('🔍 [FIELD 38 - Net Weight] net_weight: "' + (data.net_weight || 'EMPTY') + '" kg');
  console.log('🔍 [FIELD 47 - Customs Value] customs_value: "' + (data.customs_value || 'EMPTY') + '" KZT');
  console.log('🔍 [DDP] delivery_terms: "' + (data.delivery_terms || 'EMPTY') + '"');
  console.log('🔍 [GOODS] goods count: ' + (data.goods ? data.goods.length : 0));
  if (data.goods && data.goods.length > 0) {
    data.goods.forEach(function(g, i) {
      console.log('🔍 [GOODS ' + (i+1) + '] name: "' + (g.name || 'EMPTY') + '"');
      console.log('🔍 [GOODS ' + (i+1) + '] quantity: "' + (g.quantity || 'EMPTY') + '" ' + (g.unit || ''));
      console.log('🔍 [GOODS ' + (i+1) + '] gross_weight: "' + (g.gross_weight || 'EMPTY') + '" kg');
      console.log('🔍 [GOODS ' + (i+1) + '] net_weight: "' + (g.net_weight || 'EMPTY') + '" kg');
    });
  }
  console.log('═══════════════════════════════════════════════════════════════');

  // MASTER_BIN global variable
  const MASTER_BIN = data.declarant_inn;
  if (MASTER_BIN) {
    data.declarant_inn = MASTER_BIN;
    console.log('✅ [MASTER_BIN] Set to: ' + MASTER_BIN);
  }

  // Cross-summation weight validation - DO NOT override input data
  console.log('🔍 [Weight] Input gross_weight: ' + data.gross_weight + ' (IMMUTABLE)');
  if (data.goods && data.goods.length > 0 && data.gross_weight) {
    var calculatedTotalGross = data.goods.reduce(function(s, item) {
      return s + (parseFloat(item.gross_weight) || 0);
    }, 0);
    var declaredTotalGross = parseFloat(data.gross_weight) || 0;

    console.log('🔍 [Weight] Calculated from goods: ' + calculatedTotalGross + ' vs Declared: ' + declaredTotalGross);
    if (Math.abs(calculatedTotalGross - declaredTotalGross) > 0.1) {
      console.log('⚠️ [Weight] Sum mismatch: calculated ' + calculatedTotalGross + ' vs declared ' + declaredTotalGross);
      console.log('⚠️ [Weight] Keeping declared gross_weight: ' + declaredTotalGross + ' (IMMUTABLE - input data takes precedence)');
      // DO NOT override - input data is IMMUTABLE
    } else {
      console.log('✅ [Weight] Sum matches: ' + calculatedTotalGross + ' kg');
    }
  }
  // STRICT MAPPING: gross_weight from input is IMMUTABLE
  if (data.gross_weight) {
    data.IMMUTABLE_GROSS_WEIGHT = data.gross_weight;
    console.log('✅ [STRICT MAPPING] gross_weight set to IMMUTABLE: ' + data.IMMUTABLE_GROSS_WEIGHT);
  }
  // STRICT MAPPING: net_weight from input is IMMUTABLE
  if (data.net_weight) {
    data.IMMUTABLE_NET_WEIGHT = data.net_weight;
    console.log('✅ [STRICT MAPPING] net_weight set to IMMUTABLE: ' + data.IMMUTABLE_NET_WEIGHT);
  }

  // Net weight validation - DO NOT auto-calculate, use user input strictly
  if (data.goods && data.goods.length > 0) {
    data.goods.forEach(function(item) {
      if (item.gross_weight && item.net_weight) {
        var gross = parseFloat(item.gross_weight);
        var net = parseFloat(item.net_weight);
        console.log('✅ [Weight] Using user input: Gross ' + gross + ' kg, Net ' + net + ' kg');
      } else if (item.gross_weight && !item.net_weight) {
        console.log('⚠️ [Weight] Net weight missing for item, but NOT auto-calculating');
      }
    });
  }

  // Transport cross-validation with string normalization
  if (data.transport_id) {
    var transportId = data.transport_id.toString().trim().replace(/\s+/g, ' ');
    if (/^\d{3}\s*[A-Za-z]{2}\s*\d{2}$/.test(transportId)) {
      data.document_code = '02015'; // CMR for auto
      console.log('✅ [Transport] Auto transport detected → 02015');
    } else if (/^[A-Z]{4}\d{7}$/.test(transportId) || /^\d{8,}$/.test(transportId)) {
      data.document_code = '02013'; // Railway
      console.log('✅ [Transport] Railway detected → 02013');
    } else {
      console.log('⚠️ [Transport] Unknown format, defaulting to 02015');
      data.document_code = '02015';
    }
  }

  // Field 15 cleanup with source priority
  if (data.exporter_country) {
    var countryText = data.exporter_country.toString();
    if (data.declarant_name && countryText.toLowerCase().includes(data.declarant_name.toLowerCase())) {
      console.log('⚠️ [Field 15] Contains declarant name, defaulting to CN');
      data.exporter_country = 'CN';
    } else {
      var countryMatch = countryText.match(/(CN|US|RU|KZ|TR|AE|DE|GB|FR|IT|ES|PL|NL|BE|AT|CH|SE|NO|DK|FI|JP|KR|IN|BR|AR|CL|PE|MX|ZA|AU|CA|SG|MY|TH|VN|ID|PH)$/i);
      if (countryMatch) {
        data.exporter_country = countryMatch[1].toUpperCase();
        console.log('✅ [Field 15] Extracted from end: ' + data.exporter_country);
      } else {
        var anyMatch = countryText.match(/\b(CN|US|RU|KZ|TR|AE|DE|GB|FR|IT|ES|PL|NL|BE|AT|CH|SE|NO|DK|FI|JP|KR|IN|BR|AR|CL|PE|MX|ZA|AU|CA|SG|MY|TH|VN|ID|PH)\b/i);
        if (anyMatch) {
          data.exporter_country = anyMatch[1].toUpperCase();
          console.log('✅ [Field 15] Extracted: ' + data.exporter_country);
        } else {
          data.exporter_country = 'CN';
          console.log('✅ [Field 15] Defaulted to CN');
        }
      }
    }
  }

  // DDP reverse calculation logic - CRITICAL to avoid double taxation
  if (data.delivery_terms && data.delivery_terms.toUpperCase() === 'DDP') {
    console.log('🔍 [DDP CHECK] DDP terms detected - checking for reverse calculation');
    var invoiceAmountUSD = parseFloat(data.total_invoice_amount) || 0;
    var exchangeRate = parseFloat(data.exchange_rate) || 1;
    var invoiceAmountKZT = invoiceAmountUSD * exchangeRate;
    var customsValueKZT = parseFloat(data.customs_value) || invoiceAmountKZT;

    console.log('🔍 [DDP] Invoice USD: ' + invoiceAmountUSD + ', Rate: ' + exchangeRate + ', Invoice KZT: ' + invoiceAmountKZT);
    console.log('🔍 [DDP] Customs value KZT (before): ' + customsValueKZT);

    // If customs value equals invoice KZT, taxes are included - need reverse calculation
    if (Math.abs(customsValueKZT - invoiceAmountKZT) < 100) {
      console.log('⚠️ [DDP] Customs value equals invoice KZT, taxes are included - reverse calculating');
      // Formula: Customs_Value = Invoice_Total / 1.17 (as requested by user)
      var correctedCustomsValue = invoiceAmountKZT / 1.17;
      data.customs_value = correctedCustomsValue.toFixed(2);
      console.log('✅ [DDP] Customs value corrected to: ' + data.customs_value + ' (using Invoice / 1.17)');
      console.log('🔍 [DDP] Tax savings: ' + (invoiceAmountKZT - correctedCustomsValue).toFixed(2) + ' KZT (17% removed)');
    } else {
      console.log('✅ [DDP] Customs value already differs from invoice KZT, no reverse calculation needed');
    }
  } else {
    console.log('🔍 [DDP CHECK] Non-DDP terms (' + (data.delivery_terms || 'NOT SET') + ') - using standard calculation');
    // For non-DDP, set customs_value to invoice KZT if not set
    if (!data.customs_value && data.total_invoice_amount && data.exchange_rate) {
      data.customs_value = (parseFloat(data.total_invoice_amount) * parseFloat(data.exchange_rate)).toFixed(2);
      console.log('✅ [Customs] Set customs_value to invoice KZT: ' + data.customs_value);
    }
  }

  // Force packages_count to be numeric - STRICT MAPPING
  if (data.packages_count) {
    var packagesMatch = data.packages_count.match(/(\d+)/);
    if (packagesMatch) {
      data.packages_count = packagesMatch[1];
      data.IMMUTABLE_PACKAGES_COUNT = data.packages_count;
      console.log('✅ [STRICT MAPPING] packages_count set to IMMUTABLE: ' + data.IMMUTABLE_PACKAGES_COUNT);
    }
  } else {
    console.log('⚠️ [Packages] packages_count is empty - NOT using fallback to avoid hallucination');
  }
  console.log('🔍 [Packages] Final packages_count: "' + data.packages_count + '"');

  function g(key) { return (data[key] || '').toString(); }

  function getCountryCode(countryName) {
    var countryMap = {
      'Германия': 'DE',
      'Germany': 'DE',
      'DE': 'DE',
      'Китай': 'CN',
      'China': 'CN',
      'CN': 'CN',
      'США': 'US',
      'USA': 'US',
      'US': 'US',
      'Турция': 'TR',
      'Turkey': 'TR',
      'TR': 'TR',
      'Италия': 'IT',
      'Italy': 'IT',
      'IT': 'IT',
      'Франция': 'FR',
      'France': 'FR',
      'FR': 'FR',
      'Польша': 'PL',
      'Poland': 'PL',
      'PL': 'PL',
      'Россия': 'RU',
      'Russia': 'RU',
      'RU': 'RU',
      'Казахстан': 'KZ',
      'Kazakhstan': 'KZ',
      'KZ': 'KZ',
      'Узбекистан': 'UZ',
      'Uzbekistan': 'UZ',
      'UZ': 'UZ',
      'Кыргызстан': 'KG',
      'Kyrgyzstan': 'KG',
      'KG': 'KG',
      'Беларусь': 'BY',
      'Belarus': 'BY',
      'BY': 'BY',
      'Япония': 'JP',
      'Japan': 'JP',
      'JP': 'JP',
      'Корея': 'KR',
      'Korea': 'KR',
      'KR': 'KR',
      'Великобритания': 'GB',
      'United Kingdom': 'GB',
      'UK': 'GB',
      'GB': 'GB',
      'Нидерланды': 'NL',
      'Netherlands': 'NL',
      'NL': 'NL',
      'Испания': 'ES',
      'Spain': 'ES',
      'ES': 'ES',
      'Чехия': 'CZ',
      'Czech Republic': 'CZ',
      'CZ': 'CZ'
    };
    return countryMap[countryName] || countryName.substring(0, 2).toUpperCase();
  }

  var today = new Date().toLocaleDateString('ru-RU');
  var regNum = g('ref_number') || ('55302/' + new Date().toLocaleDateString('ru-RU').replace(/\./g,'') + '/' + Math.floor(Math.random()*9999999).toString().padStart(7,'0'));

  var goodsRows = (data.goods || []).map(function(item, i) {
    var totalP = parseFloat(item.total_price) || 0;
    return '<tr>' +
      '<td style="text-align:center">' + (i+1) + '</td>' +
      '<td>' + (item.name || '') + '</td>' +
      '<td style="text-align:center;font-weight:bold">' + (item.tnved || item.tnved_code || '') + '</td>' +
      '<td style="text-align:center">' + (item.origin_country || 'CN') + '</td>' +
      '<td style="text-align:right">' + (item.gross_weight || '') + '</td>' +
      '<td style="text-align:right">' + (item.net_weight || data.IMMUTABLE_NET_WEIGHT || '') + '</td>' +
      '<td style="text-align:center">' + (item.quantity || '') + ' ' + (item.unit || '') + '</td>' +
      '<td style="text-align:right">' + g('currency') + ' ' + (totalP > 0 ? totalP.toFixed(2) : (item.total_price || '')) + '</td>' +
      '<td style="text-align:center">' + (item.customs_procedure || '4000') + '</td>' +
      '</tr>';
  }).join('');

  var totalWeight = data.IMMUTABLE_GROSS_WEIGHT ? parseFloat(data.IMMUTABLE_GROSS_WEIGHT).toFixed(2) : (data.gross_weight ? parseFloat(data.gross_weight).toFixed(2) : (data.goods || []).reduce(function(s,item){return s+(parseFloat(item.gross_weight)||0);},0).toFixed(2));
  console.log('🔍 [TOTAL WEIGHT CALCULATION] Using IMMUTABLE_GROSS_WEIGHT: ' + (data.IMMUTABLE_GROSS_WEIGHT || 'NOT SET') + ', gross_weight: ' + (data.gross_weight || 'NOT SET') + ', calculated from goods: ' + (data.goods || []).reduce(function(s,item){return s+(parseFloat(item.gross_weight)||0);},0).toFixed(2) + ', final totalWeight: ' + totalWeight);
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
    + '<td style="width:8%"><div class="field-label">6 Всего мест</div><div class="field-value">' + (data.IMMUTABLE_PACKAGES_COUNT || g('packages_count')) + '</div></td>'
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
    + '<td style="width:8%"><div class="field-label">15а Код</div><div class="field-value">' + getCountryCode(g('exporter_country')) + '</div></td>'
    + '<td style="width:15%"><div class="field-label">17 Страна назначения</div><div class="field-value">КАЗАХСТАН</div></td>'
    + '<td style="width:7%"><div class="field-label">17 Код</div><div class="field-value">KZ</div></td>'
    + '<td style="width:10%"><div class="field-label">16 Страна происхождения</div><div class="field-value">' + g('exporter_country') + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:25%"><div class="field-label">18 Идентификация трансп.средства</div><div class="field-value">1:' + g('transport_id') + '</div></td>'
    + '<td style="width:5%"><div class="field-label">19</div><div class="field-value">1</div></td>'
    + '<td style="width:20%"><div class="field-label">20 Условия поставки</div><div class="field-value">' + g('delivery_terms') + '</div></td>'
    + '<td style="width:15%"><div class="field-label">22 Валюта и сумма по счету</div><div class="field-value">' + g('currency') + ' ' + g('total_invoice_amount') + '<br>KZT ' + (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2) + '</div></td>'
    + '<td style="width:8%"><div class="field-label">23 Курс валюты</div><div class="field-value">' + g('exchange_rate') + '</div></td>'
    + '<td style="width:7%"><div class="field-label">25 Вид</div><div class="field-value">' + g('transport_type') + '</div></td>'
    + '<td style="width:10%"><div class="field-label">35 Вес брутто общий</div><div class="field-value">' + totalWeight + ' кг</div></td>'
    + '<td style="width:10%"><div class="field-label">28 Финансовые сведения</div><div class="field-value">' + totalWeight + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:25%"><div class="field-label">29 Орган въезда/выезда</div><div class="field-value">' + g('border_crossing') + '</div></td>'
    + '<td style="width:25%"><div class="field-label">30 Местонахождение товаров</div></td>'
    + '<td style="width:25%"><div class="field-label">6 Всего мест / 27 Место погрузки</div><div class="field-value">' + (data.IMMUTABLE_PACKAGES_COUNT || Number(data.packages_count)) + ' мест</div></td>'
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
    + '<td style="text-align:right;font-weight:bold">' + g('currency') + ' ' + totalPrice + '<br>KZT ' + (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2) + '</td>'
    + '<td></td>'
    + '</tr></tfoot></table>'

    // Документы и платежи
    + '<table><tr>'
    + '<td style="width:60%"><div class="field-label">44 Дополнительная информация / Представленные документы</div>'
    + '<div class="field-value">'
    + (data.document_code || '02015') + ' &nbsp; ' + (data.document_code === '02015' ? 'CMR' : 'Железнодорожная накладная') + '<br>'
    + '04021 &nbsp; ' + g('invoice_number') + ' от ' + g('invoice_date') + ' Счет-фактура (инвойс)<br>'
    + '03011 &nbsp; ' + g('contract_number') + ' Договор (контракт)'
    + '</div></td>'
    + '<td style="width:40%">'
    + '<div class="field-label">47 Исчисление платежей</div>'
    + '<table style="margin:0"><tr><th>Вид</th><th>Основа начисления</th><th>Ставка</th><th>Сумма</th><th>СП</th></tr>'
    + '<tr><td>1010</td><td>KZT ' + (g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2)) + '</td><td>5%</td><td>' + (parseFloat(g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)))*0.05).toFixed(2) + '</td><td>ИУ</td></tr>'
    + '<tr><td>2010</td><td>KZT ' + (g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2)) + '</td><td>5%</td><td>' + (parseFloat(g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)))*0.05).toFixed(2) + '</td><td>ИУ</td></tr>'
    + '<tr><td>5060</td><td>KZT ' + (g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)).toFixed(2)) + '</td><td>12%</td><td>' + (parseFloat(g('customs_value') || (parseFloat(totalPrice)*(parseFloat(g('exchange_rate'))||1)))*0.12).toFixed(2) + '</td><td>ИУ</td></tr>'
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

// Helper function to generate and send PDF
async function generateAndSendPDF(chatId, data) {
  // Get exchange rate if needed
  var needsRate = !data.exchange_rate || data.exchange_rate === '0' || data.exchange_rate === '' || data.exchange_rate === '1' || data.exchange_rate === '1.00';
  if (needsRate && data.currency && data.currency.toUpperCase() !== 'KZT') {
    console.log('Getting exchange rate for ' + (data.currency || 'USD') + '...');
    const rate = await getExchangeRate(data.currency || 'USD');
    if (rate && parseFloat(rate) > 1) {
      data.exchange_rate = rate;
      console.log('Rate obtained: ' + rate + ' KZT');
    } else {
      console.log('Failed to get rate');
      data.exchange_rate = '0';
    }
  }
  
  const pdfData = await generateDTPDF(data);
  
  // Calculate totals
  const totalAmount = parseFloat(data.total_invoice_amount) || 0;
  const totalInKzt = totalAmount * (parseFloat(data.exchange_rate) || 1);
  
  await telegramBot.sendDocument(chatId, pdfData, {
    caption: '✅ Декларация создана\n\n💰 Сумма инвойса: ' + (data.currency || 'USD') + ' ' + totalAmount.toFixed(2) + '\n💱 Курс: ' + (data.exchange_rate || 'не получен') + ' тенге\n💰 Сумма в тенге: KZT ' + totalInKzt.toFixed(2),
    fileName: 'declaration.pdf'
  });
}

// Handle /ask command with AI
async function handleAskCommand(chatId, text) {
  const command = text.substring(5).trim(); // Remove '/ask '
  if (!command) {
    await telegramBot.sendMessage(chatId, 'Использование: /ask изменить имя на Новое имя');
    return;
  }
  
  // Get current data from conversation state
  const state = conversationStates.get(chatId);
  const currentData = state ? (state.existingData || state.data || {}) : {};
  
  // Build AI prompt
  const prompt = `User wants to modify declaration data. Current data: ${JSON.stringify(currentData, null, 2)}. User request: "${command}". 
  Return JSON: {"field": "field_name", "value": "new_value", "explanation": "what changed"}. 
  Fields: declarant_name, declarant_inn, declarant_address, exporter_name, exporter_country, currency, total_invoice_amount, invoice_number, contract_number, gross_weight, goods_name, goods_quantity`;
  
  try {
    const aiResponse = await callNvidia(prompt);
    let aiResult;
    try {
      aiResult = JSON.parse(aiResponse);
    } catch(e) {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\{[^}]+\}/);
      if (jsonMatch) {
        aiResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse AI response');
      }
    }
    
    if (aiResult.field && aiResult.value) {
      // Update data
      if (state) {
        if (state.existingData) {
          state.existingData[aiResult.field] = aiResult.value;
        } else {
          state.data = state.data || {};
          state.data[aiResult.field] = aiResult.value;
        }
        conversationStates.set(chatId, state);
      }
      
      // If PDF was already generated, regenerate it
      if (state && state.pdfGenerated) {
        const dataForPDF = state.existingData || state.data || {};
        await generateAndSendPDF(chatId, dataForPDF);
        await telegramBot.sendMessage(chatId, `Обновлено: ${aiResult.explanation || aiResult.field + ' изменено'}. Новый PDF отправлен.`);
      } else {
        await telegramBot.sendMessage(chatId, `Обновлено: ${aiResult.explanation || aiResult.field + ' изменено'}`);
      }
    } else {
      await telegramBot.sendMessage(chatId, 'Не удалось понять запрос. Попробуйте: /ask изменить имя на Новое имя');
    }
  } catch(e) {
    console.log('AI error:', e.message);
    await telegramBot.sendMessage(chatId, 'Ошибка службы ИИ. Попробуйте позже.');
  }
}

// ── WhatsApp события ────────────────────────────────────────────────────────
client.on('qr', function(qr) {
  currentQR = qr;
  botState = 'qr';
  console.log('\n📱 QR готов! Открой: ' + PANEL_URL);
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
    console.log('🌐 Панель: ' + PANEL_URL);
  } catch(e) { console.log('✅ Бот запущен!'); }

  // Verify client is fully functional
  try {
    var chats = await client.getChats();
    console.log('✅ WhatsApp API работает, чатов: ' + chats.length);
  } catch(e) {
    console.log('❌ WhatsApp API недоступен: ' + e.message);
  }

  // Polling disabled - event handlers should be sufficient for message detection
});

client.on('disconnected', function() {
  botState = 'disconnected';
  connectedPhone = '';
  console.log('🔌 WhatsApp отключён');
});

// ── WhatsApp /ask command handler ──────────────────────────────────────────
// ── WhatsApp: generate and send PDF ────────────────────────────────────────
async function generateAndSendPDFWhatsApp(chat, data) {
  var needsRate = !data.exchange_rate || data.exchange_rate === '0' || data.exchange_rate === '' || data.exchange_rate === '1' || data.exchange_rate === '1.00';
  if (needsRate && data.currency && data.currency.toUpperCase() !== 'KZT') {
    var rate = await getExchangeRate(data.currency || 'USD');
    if (rate && parseFloat(rate) > 1) data.exchange_rate = rate;
    else data.exchange_rate = '0';
  }
  var pdfPath = await generateDTPDF(data);
  var totalAmount = parseFloat(data.total_invoice_amount) || 0;
  var totalInKzt = totalAmount * (parseFloat(data.exchange_rate) || 1);
  var media = MessageMedia.fromFilePath(pdfPath);
  await chat.sendMessage(media, {
    caption: '✅ Декларация создана\n\n💰 Сумма инвойса: ' + (data.currency || 'USD') + ' ' + totalAmount.toFixed(2) +
             '\n💱 Курс: ' + (data.exchange_rate || 'не получен') + ' тенге' +
             '\n💰 Сумма в тенге: KZT ' + totalInKzt.toFixed(2)
  });
  try { fs.unlinkSync(pdfPath); } catch(e) {}
  statsCount++;
  console.log('✅ WhatsApp PDF отправлен!');
}

// ── WhatsApp: /ask command ──────────────────────────────────────────────────
async function handleAskCommandWA(chat, chatId, text) {
  var command = text.substring(5).trim();
  if (!command) {
    await chat.sendMessage('Использование: /ask изменить имя на Новое имя');
    return;
  }
  var state = conversationStates.get(chatId);
  var currentData = state ? (state.existingData || state.data || {}) : {};
  var prompt = 'User wants to modify declaration data. Current data: ' + JSON.stringify(currentData, null, 2) + '. User request: "' + command + '". Return JSON: {"field": "field_name", "value": "new_value", "explanation": "what changed"}. Fields: declarant_name, declarant_inn, declarant_address, exporter_name, exporter_country, currency, total_invoice_amount, invoice_number, contract_number, gross_weight, goods_name, goods_quantity';
  try {
    var aiResponse = await callNvidia(prompt);
    var aiResult;
    try { aiResult = JSON.parse(aiResponse); } catch(e) {
      var jsonMatch = aiResponse.match(/\{[^}]+\}/);
      if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);
      else throw new Error('Could not parse AI response');
    }
    if (aiResult.field && aiResult.value) {
      if (state) {
        var dataObj = state.existingData || state.data || {};
        dataObj[aiResult.field] = aiResult.value;
        if (state.existingData) state.existingData = dataObj;
        else state.data = dataObj;
        conversationStates.set(chatId, state);
        var analysis = analyzeMissingData(dataObj);
        if (analysis.hasAllData) {
          await generateAndSendPDFWhatsApp(chat, dataObj);
          await chat.sendMessage('Обновлено: ' + (aiResult.explanation || aiResult.field + ' изменено') + '. Новый PDF отправлен.');
          return;
        }
      }
      await chat.sendMessage('✅ Обновлено: ' + (aiResult.explanation || aiResult.field + ' изменено'));
    } else {
      await chat.sendMessage('Не удалось понять запрос. Попробуйте: /ask изменить имя на Новое имя');
    }
  } catch(e) {
    console.log('WhatsApp /ask error:', e.message);
    await chat.sendMessage('Ошибка службы ИИ. Попробуйте позже.');
  }
}

// ── WhatsApp: conversational question flow ──────────────────────────────────
async function startQuestionFlowWA(chat, chatId, existingData) {
  var analysis = analyzeMissingData(existingData);
  if (analysis.hasAllData) {
    await generateAndSendPDFWhatsApp(chat, existingData);
    return;
  }
  var missingQuestions = FIELD_QUESTIONS.filter(function(fq) { return analysis.missing.includes(fq.field); });
  if (missingQuestions.length === 0) {
    await generateAndSendPDFWhatsApp(chat, existingData);
    return;
  }
  conversationStates.set(chatId, {
    step: 'asking_questions',
    existingData: existingData,
    questions: missingQuestions,
    currentQuestion: 0,
    timestamp: Date.now()
  });
  var intro = '📝 Заполним декларацию вместе:\n\n';
  await chat.sendMessage(intro + missingQuestions[0].q);
}

async function handleQuestionAnswerWA(chat, chatId, text, state) {
  var questions = state.questions;
  var currentQuestion = state.currentQuestion;
  var existingData = state.existingData;
  var currentQ = questions[currentQuestion];
  existingData[currentQ.field] = text.trim();
  var nextIdx = currentQuestion + 1;
  if (nextIdx < questions.length) {
    state.currentQuestion = nextIdx;
    state.existingData = existingData;
    state.timestamp = Date.now();
    conversationStates.set(chatId, state);
    // Clean up active_processing before sending next question
    active_processing.delete(chatId);
    processingChats.delete(chatId);
    await chat.sendMessage(questions[nextIdx].q);
  } else {
    conversationStates.delete(chatId);
    active_processing.delete(chatId);
    processingChats.delete(chatId);
    await generateAndSendPDFWhatsApp(chat, existingData);
  }
}

// ── WhatsApp message handler (mirrors Telegram exactly) ─────────────────────
var _waHandledIds = new Set();
var processingChats = new Map(); // Per-chat processing lock to prevent spam

// ── Strict Control Flow: Gatekeeper Maps ───────────────────────────────────
var active_processing = new Map(); // sender_id -> processing state
var statusSentForMessages = new Set(); // Track which incoming messages received status
var globalProcessingLock = false; // Global lock to prevent any duplicate processing

// ── Single Status Message Helper ───────────────────────────────────────────
async function sendSingleStatus(chat, incomingMessageId) {
  if (statusSentForMessages.has(incomingMessageId)) {
    console.log('🚫 Status already sent for message ' + incomingMessageId + ', skipping');
    return false;
  }
  statusSentForMessages.add(incomingMessageId);
  // Cleanup old entries to prevent memory leak
  if (statusSentForMessages.size > 100) {
    var entries = Array.from(statusSentForMessages);
    statusSentForMessages = new Set(entries.slice(-50));
  }
  await chat.sendMessage('🚀 Начинаю создавать декларацию...');
  console.log('✅ Status sent for message ' + incomingMessageId);
  return true;
}

async function handleMessage(msg) {
  var chatId = null; // Declare outside try block for finally block access
  var senderId = null; // Track sender for cleanup
  
  try {
    var chat = await msg.getChat();
    chatId = chat.id._serialized;
    senderId = msg.from;

    console.log('🔔 Message received - fromMe:', msg.fromMe, 'hasBody:', !!msg.body, 'body:', msg.body ? msg.body.substring(0, 50) : 'null');
    
    if (!msg.body) return;

    // Check if chat is in active state before blocking fromMe messages
    var state = conversationStates.get(chatId);
    var isActiveState = state && state.step && (Date.now() - (state.timestamp || 0)) < 600000;

    // ── GATEKEEPER 1: Check fromMe immediately ─────────────────────────────
    // Allow fromMe messages that contain the keyword (user's own keyword trigger)
    // Allow fromMe messages when in active state (expecting_form_data, etc.)
    // Block fromMe messages that are bot's own responses (don't contain keyword and not in active state)
    if (msg.fromMe && !msg.body.toLowerCase().includes(KEYWORD_DYNAMIC.toLowerCase()) && !isActiveState) {
      console.log('🚫 Ignoring own message (fromMe=true, no keyword, no active state)');
      return;
    }

    // Deduplicate: both 'message' and 'message_create' events fire for the same msg
    var msgId = msg.id && msg.id.id;
    if (msgId) {
      if (_waHandledIds.has(msgId)) return;
      _waHandledIds.add(msgId);
      if (_waHandledIds.size > 500) {
        _waHandledIds = new Set(Array.from(_waHandledIds).slice(-200));
      }
    }

    // chat and chatId already set above
    senderId = chatId; // Use chatId as senderId for tracking
    var text = msg.body;

    // ── GATEKEEPER 0: Ignore own error messages ─────────────────────────────
    if (msg.fromMe && text.startsWith('⚠️ Ошибка:')) {
      console.log('🚫 Ignoring own error message');
      return;
    }

    // ── GATEKEEPER 1: Check global processing lock ─────────────────────────
    if (globalProcessingLock) {
      console.log('🚫 Global processing lock is active, ignoring request');
      return;
    }
    globalProcessingLock = true;

    // ── GATEKEEPER 2: Check active_processing Map ─────────────────────────
    if (active_processing.has(senderId)) {
      console.log('🚫 Sender ' + senderId + ' is already being processed, silently returning');
      globalProcessingLock = false;
      return;
    }
    active_processing.set(senderId, true);
    console.log('✅ Added ' + senderId + ' to active_processing');

    // Keep legacy processingChats for compatibility (can be removed later)
    if (processingChats.has(chatId)) {
      console.log('🚫 Chat ' + chatId + ' is already being processed (legacy lock), ignoring');
      active_processing.delete(senderId);
      return;
    }
    processingChats.set(chatId, true);

    console.log('📨 WhatsApp от ' + (chat.name || chatId) + ' [fromMe=' + msg.fromMe + ']: ' + text.substring(0, 60));
    console.log('🔍 Checking keyword: "' + KEYWORD_DYNAMIC + '" in text: "' + text + '"');

    // ── 1. Keyword trigger (works without active state) ────────────────────
    console.log('🔍 Keyword check: text.toLowerCase()=' + text.toLowerCase() + ', KEYWORD_DYNAMIC.toLowerCase()=' + KEYWORD_DYNAMIC.toLowerCase());
    // Use includes match (case-insensitive) to be more flexible
    if (text.toLowerCase().includes(KEYWORD_DYNAMIC.toLowerCase())) {
      console.log('🔑 Ключевое слово WhatsApp от ' + chatId);
      // Save message to history
      addWhatsAppMessage(chatId, text);
      // Clear processing lock before sending response to prevent blocking own messages
      processingChats.delete(chatId);
      active_processing.delete(senderId);
      await chat.sendMessage(generateDeclarationMessage());
      // Set state to expect form data
      conversationStates.set(chatId, {
        step: 'expecting_form_data',
        timestamp: Date.now()
      });
      return;
    }

    // ── 2. Commands ───────────────────────────────────────────────────────
    if (text.startsWith('/ask')) {
      processingChats.delete(chatId);
      active_processing.delete(senderId);
      await chat.sendMessage('📝 Введите ваш запрос для изменения данных через ИИ:');
      conversationStates.set(chatId, { step: 'waiting_for_ai_query', timestamp: Date.now() });
      return;
    }
    if (text.startsWith('/reset')) {
      processingChats.delete(chatId);
      active_processing.delete(senderId);
      conversationStates.delete(chatId);
      await chat.sendMessage('🔄 Диалог сброшен. Отправьте кодовое слово для начала нового диалога.');
      return;
    }
    if (text.startsWith('/help')) {
      processingChats.delete(chatId);
      active_processing.delete(senderId);
      await chat.sendMessage(
        '🤖 Команды:\n\n' +
        '/ask <запрос> — изменить данные через ИИ\n' +
        '/reset — сбросить диалог\n' +
        '/help — показать это сообщение\n\n' +
        'Для создания декларации отправьте кодовое слово.'
      );
      return;
    }

    // ── 3. Active state ───────────────────────────────────────────────────
    var state = conversationStates.get(chatId);
    if (!state) {
      console.log('🚫 WhatsApp: нет активного диалога, игнорирую');
      return;
    }
    if (state.timestamp && (Date.now() - state.timestamp) > 600000) {
      conversationStates.delete(chatId);
      return;
    }

    // Save message to history for analysis
    addWhatsAppMessage(chatId, text);

    if (state.step === 'expecting_form_data') {
      // User submitted the form data
      console.log('📝 Получены данные формы от ' + chatId);
      console.log('📝 Текст сообщения:', text.substring(0, 100));
      
      // Status already sent after lock acquisition (line 1755)
      
      processingChats.delete(chatId);
      // Note: Don't delete active_processing yet - keep it until complete

      try {
        // Parse the form data
        console.log('🔍 Начинаю парсинг данных...');
        var parsed = parseEnhancedFormData(text);
        console.log('✅ Данные распарсены:', Object.keys(parsed).filter(k => parsed[k]).length + ' полей');
        console.log('📋 Parsed data:', JSON.stringify(parsed, null, 2));

        // Get exchange rate if needed
        if (!parsed.exchange_rate || parsed.exchange_rate === '0') {
          var rate = await getExchangeRate(parsed.currency || 'USD');
          if (rate) parsed.exchange_rate = rate;
        }

        // Enrich goods with TNVED codes
        console.log('🔍 Начинаю обогащение TN VED кодов...');
        await enrichGoodsWithOfficialTnved(parsed.goods || []);
        console.log('✅ TN VED коды обогащены');

        // Check if any goods don't have TN VED codes
        var missingTnvedGoods = [];
        if (parsed.goods && parsed.goods.length > 0) {
          for (var i = 0; i < parsed.goods.length; i++) {
            var good = parsed.goods[i];
            if (!good.tnved_code && !good.tnved) {
              missingTnvedGoods.push(good.name || 'Неизвестный товар');
            }
          }
        }

        if (missingTnvedGoods.length > 0) {
          console.log('❌ ТН ВЭД коды не найдены для товаров:', missingTnvedGoods);
          await chat.sendMessage('⚠️ Ошибка: Не удалось найти код ТН ВЭД для товаров:\n' + missingTnvedGoods.join('\n') + '\n\n💡 Пожалуйста, уточните наименование товара или введите код ТН ВЭД вручную. Отправьте кодовое слово для начала нового диалога.');
          conversationStates.delete(chatId);
          return;
        }

        // ── VALIDATION LOGIC (Consolidation) ───────────────────────────────
        console.log('🔍 Начинаю валидацию данных...');
        var validation = validateDeclarationData(parsed);
        console.log('📋 Validation result:', JSON.stringify(validation, null, 2));
        if (!validation.valid) {
          console.log('❌ Валидация не прошла');
          // Collect all errors into array and send ONE message
          var errorArray = [];
          if (validation.required && validation.required.length > 0) {
            errorArray = errorArray.concat(validation.required);
          }
          if (validation.optional && validation.optional.length > 0) {
            errorArray = errorArray.concat(validation.optional);
          }

          if (errorArray.length > 0) {
            await chat.sendMessage('⚠️ Не хватает обязательных данных:\n' + errorArray.join('\n') + '\n\n💡 Отправьте кодовое слово для начала нового диалога.');
          }
          // Delete conversation state so user can send keyword to start fresh
          conversationStates.delete(chatId);
          return;
        }

        console.log('✅ Валидация прошла успешно, начинаю генерацию PDF...');
        
        // Only send status if we have valid data and can proceed
        if (parsed && parsed.goods && parsed.goods.length > 0 && parsed.goods[0].name && parsed.goods[0].name !== 'Товар') {
          await sendSingleStatus(chat, msgId);
        } else {
          console.log('⚠️ [Handler] Invalid data, not sending status');
          await chat.sendMessage('⚠️ Ошибка: Не удалось распознать данные. Пожалуйста, проверьте формат.');
          conversationStates.delete(chatId);
          return;
        }
        // ── FINAL EXECUTION ───────────────────────────────────────────────
        // Generate and send PDF
        await generateAndSendPDFWhatsApp(chat, parsed);
        console.log('✅ PDF отправлен успешно');
        conversationStates.delete(chatId);
      } catch(e) {
        console.error('❌ Ошибка обработки формы:', e.message);
        await chat.sendMessage('❌ Ошибка: ' + e.message);
        conversationStates.delete(chatId);
      }
      return;
    }
    if (state.step === 'asking_questions') {
      await handleQuestionAnswerWA(chat, chatId, text, state);
      return;
    }
    conversationStates.delete(chatId);

  } catch(err) {
    console.error('❌ WhatsApp ошибка:', err.message);
    try {
      var chat2 = await msg.getChat();
      processingChats.delete(chatId);
      await chat2.sendMessage('❌ Ошибка: ' + err.message);
    } catch(e) {}
  } finally {
    // ── FINAL CLEANUP: Remove from active_processing ───────────────────────
    if (chatId) {
      processingChats.delete(chatId);
    }
    if (senderId) {
      active_processing.delete(senderId);
      console.log('✅ Removed ' + senderId + ' from active_processing');
    }
    // Reset global processing lock
    globalProcessingLock = false;
    console.log('✅ Global processing lock reset');
  }
}

// Register 'message_create' event to receive all messages including self-chat
client.on('message_create', handleMessage);


function initializeClientWithRetry(attempt) {
  var maxAttempts = 24;
  var retryDelayMs = 10000;
  var currentAttempt = attempt || 1;

  cleanupChromeSingletonLocks(AUTH_DIR);
  cleanupChromeSingletonLocks(WHATSAPP_SESSION_DIR);

  client.initialize().catch(function(err) {
    var message = (err && err.message) ? err.message : String(err);
    var isProfileLock = message.indexOf('profile appears to be in use') >= 0 || message.indexOf('ProcessSingleton') >= 0;

    console.error('❌ Ошибка инициализации WhatsApp:', message);

    if (isProfileLock && currentAttempt < maxAttempts) {
      console.log('⏳ Chromium profile ещё занят. Попытка ' + currentAttempt + '/' + maxAttempts + ', жду ' + Math.round(retryDelayMs / 1000) + ' сек...');
      cleanupChromeSingletonLocks(WHATSAPP_SESSION_DIR);
      setTimeout(function() {
        initializeClientWithRetry(currentAttempt + 1);
      }, retryDelayMs);
      return;
    }

    if (isProfileLock) {
      console.error('❌ WhatsApp не может запуститься: Profile is locked');
      process.exit(1);
    }

    console.error('❌ WhatsApp не может запуститься:', message);
    process.exit(1);
  });
}

initializeClientWithRetry();

// Initialize Telegram bot
if (TELEGRAM_TOKEN && telegramBot === null) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    
    console.log('🤖 Telegram бот запущен: @customskzbot');
    
// ── Telegram: conversational question flow helpers ──────────────────────────


async function startQuestionFlow(chatId, existingData) {
  const analysis = analyzeMissingData(existingData);
  if (analysis.hasAllData) {
    await generateAndSendPDF(chatId, existingData);
    return;
  }
  const missingQuestions = FIELD_QUESTIONS.filter(fq => analysis.missing.includes(fq.field));
  if (missingQuestions.length === 0) {
    await generateAndSendPDF(chatId, existingData);
    return;
  }
  conversationStates.set(chatId, {
    step: 'asking_questions',
    existingData: existingData,
    questions: missingQuestions,
    currentQuestion: 0,
    timestamp: Date.now()
  });
  const intro = Object.keys(existingData).length > 0
    ? '✅ Нашёл часть данных. Уточните оставшееся:\n\n'
    : '📝 Заполним декларацию вместе:\n\n';
  await telegramBot.sendMessage(chatId, intro + missingQuestions[0].q);
}

async function handleQuestionAnswer(chatId, text, state) {
  const { questions, currentQuestion, existingData } = state;
  const currentQ = questions[currentQuestion];
  // Save answer to field
  existingData[currentQ.field] = text.trim();
  const nextIdx = currentQuestion + 1;
  if (nextIdx < questions.length) {
    state.currentQuestion = nextIdx;
    state.existingData = existingData;
    state.timestamp = Date.now();
    conversationStates.set(chatId, state);
    await telegramBot.sendMessage(chatId, questions[nextIdx].q);
  } else {
    // All questions answered
    conversationStates.delete(chatId);
    await generateAndSendPDF(chatId, existingData);
  }
}

// ── Telegram message handler ─────────────────────────────────────────────────
    telegramBot.on('message', async (msg) => {
      try {
        if (!msg.text) return;
        const chatId = msg.chat.id;
        const text = msg.text;
        console.log('📨 Telegram от ' + (msg.from ? msg.from.first_name : 'User') + ': ' + text.substring(0, 60));

        // ── 1. Commands (always handled) ──────────────────────────────────
        if (text.startsWith('/ask')) {
          await handleAskCommand(chatId, text);
          return;
        }
        if (text.startsWith('/reset') || text.startsWith('/stop') || text.startsWith('/clear')) {
          conversationStates.delete(chatId);
          await telegramBot.sendMessage(chatId, '✅ Диалог сброшен. Отправьте кодовое слово для начала нового диалога.');
          return;
        }
        if (text.startsWith('/help')) {
          await telegramBot.sendMessage(chatId,
            '🤖 *Команды:*\n\n' +
            '• `/ask <запрос>` — изменить данные через ИИ\n' +
            '• `/reset` — сбросить диалог\n' +
            '• `/help` — показать это сообщение\n\n' +
            'Для создания декларации отправьте кодовое слово.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // ── 2. Keyword trigger ────────────────────────────────────────────
        if (text.toLowerCase().includes(KEYWORD_DYNAMIC.toLowerCase())) {
          console.log('🔑 Ключевое слово обнаружено от ' + chatId);
          addTelegramMessage(chatId, text);
          const existingData = analyzeTelegramChatHistory(chatId);
          await startQuestionFlow(chatId, existingData);
          return;
        }

        // ── 3. Active state handling ──────────────────────────────────────
        const state = conversationStates.get(chatId);

        if (!state) {
          // No active state, no keyword, no command → silently ignore
          console.log('🚫 Ignoring message — no active state, no keyword: "' + text.substring(0, 40) + '"');
          return;
        }

        // Expire state after 10 minutes of inactivity
        if (state.timestamp && (Date.now() - state.timestamp) > 600000) {
          conversationStates.delete(chatId);
          console.log('⏰ State expired for ' + chatId);
          return;
        }

        addTelegramMessage(chatId, text);

        if (state.step === 'asking_questions') {
          await handleQuestionAnswer(chatId, text, state);
          return;
        }

        // Fallback: should not normally be reached, but handle stale states gracefully
        console.log('⚠️ Unhandled state step "' + state.step + '" for ' + chatId + ', clearing.');
        conversationStates.delete(chatId);

      } catch (error) {
        console.error('❌ Ошибка обработки Telegram сообщения:', error.message);
        try { await telegramBot.sendMessage(msg.chat.id, '❌ Ошибка: ' + error.message); } catch(e) {}
      }
    });
    
    // Handle errors
    telegramBot.on('polling_error', (error) => {
      console.error('❌ Telegram polling error:', error.message);
    });
    
  } catch (error) {
    console.error('❌ Ошибка инициализации Telegram бота:', error.message);
  }
}
