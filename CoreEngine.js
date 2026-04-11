// CoreEngine - Shared business logic for WhatsApp and Telegram bots
const { parseEnhancedFormData, analyzeMissingData } = require('./enhanced_parser.js');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// NVIDIA API Key
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Local TN VED dictionary for priority goods (no spaces)
// NOTE: Using universal codes ending in 0000 for broader classification
const CONST_TNVED = {
  // Power electronics - inverters (renewable energy systems)
  'инвертор': '8504408500',
  'inverter': '8504408500',
  'солнечный инвертор': '8504408500',
  'solar inverter': '8504408500',
  'преобразователь': '8504408500',
  'converter': '8504408500',
  'power converter': '8504408500',
  'dc/ac': '8504408500',
  'dc-ac': '8504408500',
  'инверторный': '8504408500',
  'преобразовательный': '8504408500',
  // Photoelectric devices - solar panels/modules (universal code)
  'солнечная панель': '8541430000',
  'solar panel': '8541430000',
  'фотоэлектрическая панель': '8541430000',
  'photovoltaic panel': '8541430000',
  'солнечный модуль': '8541430000',
  'solar module': '8541430000',
  'фотоэлектрический модуль': '8541430000',
  'photovoltaic module': '8541430000',
  'панель': '8541430000',
  'модуль': '8541430000',
  'солнечный': '8541430000',
  'фотоэлектрический': '8541430000',
  'фотоэлемент': '8541430000',
  'photovoltaic': '8541430000',
  'solar': '8541430000',
  'pv': '8541430000',
  'модуль солнечный': '8541430000',
  'панель солнечная': '8541430000',
  'элемент фотоэлектрический': '8541430000',
  // Additional variations for component breakdown matching
  'фотоэлектрический солнечный': '8541430000',
  'солнечный фотоэлектрический': '8541430000',
  'солнечный модуль': '8541430000',
  'фотоэлектрический модуль': '8541430000',
  // Energy storage - lithium-ion batteries (expanded keywords)
  'литий-ионная батарея': '8507600000',
  'lithium-ion battery': '8507600000',
  'система хранения энергии': '8507600000',
  'energy storage system': '8507600000',
  'аккумуляторная система': '8507600000',
  'battery system': '8507600000',
  'батарея': '8507600000',
  'battery': '8507600000',
  'аккумулятор': '8507600000',
  'accumulator': '8507600000',
  'литий-ионная': '8507600000',
  'lithium-ion': '8507600000',
  'система хранения': '8507600000',
  'energy storage': '8507600000',
  'хранения энергии': '8507600000',
  'battery-box': '8507600000',
  'battery box': '8507600000',
  'накопитель энергии': '8507600000',
  'energy accumulator': '8507600000',
  // Air conditioning (8415 group)
  'кондиционер': '8415100000',
  'air conditioner': '8415100000',
  'сплит-система': '8415100000',
  'split system': '8415100000',
  'климатическая система': '8415100000',
  'climate system': '8415100000',
  'воздушное охлаждение': '8415100000',
  'air cooling': '8415100000',
  // Electronics (generic)
  'электроника': '8542390000',
  'electronics': '8542390000',
  // Electrical equipment (generic)
  'электрооборудование': '8543700000',
  'electrical equipment': '8543700000',
  // Display devices
  'монитор': '8528521000',
  'monitor': '8528521000',
  'lcd': '8528521000',
  'дисплей': '8528521000',
  'display': '8528521000',
  // Cleaning appliances
  'принтер': '8443310000',
  'printer': '8443310000',
  'пылесос': '8508110000',
  'vacuum': '8508110000',
  'robot': '8508110000',
  // Communication devices
  'телефон': '8517120000',
  'телефоны': '8517120000',
  'смартфон': '8517120000',
  'smartphone': '8517120000',
  'телефонный аппарат': '8517120000',
  // Computing devices
  'ноутбук': '8471300000',
  'laptop': '8471300000',
  'компьютер': '8471300000',
  'computer': '8471300000',
  // Imaging devices
  'камера': '8525800000',
  'camera': '8525800000',
  'видеокамера': '8525800000',
  'webcam': '8525800000',
  // Audio devices
  'наушники': '8518300000',
  'headphones': '8518300000',
  'гарнитура': '8518300000',
  'микрофон': '8518300000',
  'microphone': '8518300000',
  'колонки': '8518300000',
  'динамик': '8518300000',
  'speaker': '8518300000',
  // Network devices
  'роутер': '8517620000',
  'router': '8517620000',
  'маршрутизатор': '8517620000',
  'модем': '8517620000',
  'modem': '8517620000',
  
  // Product group mappings (for fallback)
  'группа 8541': '8541430000', // Photoelectric devices
  'группа 8504': '8504408500', // Converters
  'группа 8507': '8507600000', // Batteries
};

// Product group synonyms for semantic search
const PRODUCT_GROUP_SYNONYMS = {
  '8541': ['модуль', 'панель', 'фотоэлемент', 'солнечный', 'фотоэлектрический', 'photovoltaic', 'solar', 'pv'],
  '8504': ['инвертор', 'преобразователь', 'converter', 'power converter', 'dc/ac', 'dc-ac'],
  '8507': ['батарея', 'аккумулятор', 'накопитель', 'battery', 'accumulator', 'storage'],
};

// Simple lemmatization for Russian (basic form)
function lemmatizeRussian(word) {
  // Remove common endings - order matters (longer first)
  var endings = ['монокристаллический', 'поликристаллический', 'гибридный', 'ые', 'ых', 'их', 'ие', 'ий', 'ый', 'ой', 'ая', 'яя', 'ее', 'ому', 'ему', 'ым', 'им', 'ей', 'ую', 'юю', 'и'];
  for (var i = 0; i < endings.length; i++) {
    if (word.endsWith(endings[i])) {
      var base = word.substring(0, word.length - endings[i].length);
      // Add 'ый' ending if we removed 'ые' (plural to singular)
      if (endings[i] === 'ые' || endings[i] === 'ых') {
        base += 'ый';
      }
      // Add 'ий' ending if we removed 'ие' (adjective plural)
      if (endings[i] === 'ие') {
        base += 'ий';
      }
      // Add 'ь' ending if we removed 'и' (noun plural)
      if (endings[i] === 'и') {
        base += 'ь';
      }
      return base;
    }
  }
  return word;
}

// Extract core product name with noise removal and lemmatization
function extractCoreProductName(fullName) {
  var cleaned = fullName
    .toLowerCase()
    .replace(/["'«»()]/g, '') // Remove symbols that break API
    .replace(/%/g, '')
    .replace(/монокристаллический|поликристаллический|гибридный/gi, '')
    .replace(/(?:мощность|мощность\s*\d+\s*вт|power\s*\d+\s*w)/gi, '')
    .replace(/(?:тип|type|model|модель)/gi, '');
  
  // Extract keywords and lemmatize
  var words = cleaned.split(/\s+/).filter(function(w) { return w.length > 2; });
  var lemmatized = words.map(function(w) { return lemmatizeRussian(w); });
  
  // Find best 2-word combination
  var keywords = ['солнечный', 'фотоэлектрический', 'модуль', 'панель', 'инвертор', 'преобразователь', 'батарея', 'аккумулятор'];
  var foundKeywords = lemmatized.filter(function(w) { return keywords.indexOf(w) > -1; });
  
  if (foundKeywords.length >= 2) {
    return foundKeywords.slice(0, 2).join(' ');
  } else if (foundKeywords.length === 1) {
    return foundKeywords[0];
  }
  
  // Fallback: return first 2 meaningful words
  return lemmatized.slice(0, 2).join(' ');
}

// Handle unsure between codes for Field 31 description
function handleUnsureCodes(candidates, goodsName, technicalSpecs) {
  if (candidates.length > 1) {
    console.log('⚠️ [Multiple Codes] Found ' + candidates.length + ' candidates, forming Field 31 description');
    
    // Extract distinguishing characteristics
    var description = 'Код выбран на основе: ';
    var characteristics = [];
    
    if (technicalSpecs.power) {
      characteristics.push('мощность ' + technicalSpecs.power);
    }
    if (technicalSpecs.voltage) {
      characteristics.push('напряжение ' + technicalSpecs.voltage);
    }
    if (goodsName.includes('монокристаллический')) {
      characteristics.push('тип: монокристаллический');
    }
    if (goodsName.includes('поликристаллический')) {
      characteristics.push('тип: поликристаллический');
    }
    
    description += characteristics.join(', ') || 'технических характеристик товара';
    
    return {
      code: candidates[0].code, // Select first as best match
      description: description,
      alternatives: candidates.slice(1).map(function(c) { return c.code; })
    };
  }
  return candidates[0];
}

// NVIDIA AI as Classifier Assistant (not generator)
async function classifyFromKGDResults(goodsName, kgdResults) {
  if (!kgdResults || kgdResults.length === 0) {
    return null; // No codes to classify from
  }
  
  var prompt = 'Select the best TN VED code from this official KGD list for: "' + goodsName + '"\n' +
    'Candidates:\n' + kgdResults.map(function(r) { return r.code + ': ' + r.description; }).join('\n') +
    '\nReturn only the code that best matches based on technical characteristics. DO NOT generate new codes.';
  
  var aiResponse = await callNvidia(prompt);
  var selectedCode = aiResponse.match(/\d{10}/);
  
  if (selectedCode) {
    var matched = kgdResults.find(function(r) { return r.code === selectedCode[0]; });
    if (matched) {
      return matched;
    }
  }
  
  return kgdResults[0]; // Fallback to first result
}

// Keyword for triggering declaration
let KEYWORD_DYNAMIC = 'декларация';

function setKeyword(keyword) {
  KEYWORD_DYNAMIC = keyword;
}

// Generate unified declaration form message for both platforms
function generateDeclarationMessage() {
  return '📝 Отправьте данные для декларации:\n\n' +
         '⚠️ Обязательно заполняйте все поля по порядку (каждое значение с новой строки)\n\n' +
         '1. Название декларанта\n' +
         '2. БИН/ИИН (12 цифр)\n' +
         '3. Адрес декларанта\n' +
         '4. Название экспортера\n' +
         '5. Страна (CN или Китай)\n' +
         '6. Адрес экспортера\n' +
         '7. Номер инвойса\n' +
         '8. Дата инвойса (дд.мм.гггг)\n' +
         '9. Сумма инвойса\n' +
         '10. Валюта (USD, EUR, CNY, KZT)\n' +
         '11. Номер контракта\n' +
         '12. Условия поставки (EXW, FOB, CIF и т.д.)\n' +
         '13. Пункт пропуска границы\n' +
         '14. Номер транспортного средства\n' +
         '15. Финансовый документ\n' +
         '16. Брутто вес (кг)\n' +
         '17. Нетто вес (кг)\n' +
         '18. Количество мест\n' +
         '19. Наименование товара\n' +
         '20. Количество товара\n' +
         '21. Страна происхождения товара\n\n' +
         '💡 Если что-то не понятно, напишите команду /ask и напишите свой вопрос';
}

// Process form data from user input
function processFormData(text) {
  console.log('📝 Обрабатываю форму');
  console.log('📝 Received text length:', text.length);
  console.log('📝 Line count:', text.split('\n').length);
  
  try {
    var data = parseEnhancedFormData(text);
    console.log('📝 Declarant name:', data.declarant_name);
    console.log('📝 Exporter name:', data.exporter_name);
    console.log('📝 Invoice amount:', data.total_invoice_amount);
    return data;
  } catch(e) {
    console.error('❌ Ошибка парсинга формы:', e.message);
    throw e;
  }
}

// NVIDIA API call
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
          // Log response structure for debugging
          console.log('🔍 NVIDIA API response status:', res.statusCode);
          console.log('🔍 NVIDIA API response keys:', Object.keys(result || {}));
          
          if (!result || !result.choices || !result.choices[0] || !result.choices[0].message) {
            console.log('🔍 Full response data:', JSON.stringify(result).slice(0, 500));
            reject(new Error('Invalid API response structure'));
            return;
          }
          resolve(result.choices[0].message.content);
        } catch(e) {
          console.log('🔍 Parse error - raw data:', data.slice(0, 500));
          reject(new Error('API parse error: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', function(e) { reject(e); });
    req.setTimeout(60000, function() { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// AI Pre-Analysis: Convert commercial name to technical description
async function convertToTechnicalDescription(commercialName) {
  console.log('🤖 [AI Analysis] Converting commercial name to technical description: ' + commercialName);
  var prompt = 'Ты эксперт таможенной классификации. Преобразуй коммерческое название "' + commercialName + '" в техническое описание для таможенного реестра.\n\nПравила:\n1. Укажи основную функцию устройства (преобразователь, дисплей, накопитель, и т.д.)\n2. Укажи тип энергии (солнечная, электрическая, сетевая)\n3. Укажи область применения (бытовая, промышленная, коммерческая)\n4. Укажи ключевые характеристики (напряжение, мощность, если известны)\n5. НЕ включай названия брендов (Xiaomi, Samsung, etc.)\n6. НЕ включай модельные номера\n\nПримеры:\n- "Сетевой солнечный инвертор Sungrow SG110CX" -> "Статический преобразователь для фотоэлектрических систем"\n- "Xiaomi Mi Robot Vacuum-Mop 2" -> "Бытовой пылесос робот"\n- "Samsung Monitor 27" -> "Монитор компьютерный LCD"\n\nВыдай только техническое описание (2-5 слов на русском).';
  
  try {
    var response = await callNvidia(prompt);
    var technicalDesc = response.trim();
    console.log('✅ [AI Analysis]: "' + commercialName + '" -> "' + technicalDesc + '"');
    return technicalDesc;
  } catch(e) {
    console.error('❌ [AI Analysis] Failed:', e.message);
    // Return original name if AI fails
    return commercialName;
  }
}

// Category rules for TN VED validation
const CATEGORY_RULES = {
  // Power electronics
  'инвертор': { forbidden: ['8501', '8419'], required: '8504' },
  'инверторы': { forbidden: ['8501', '8419'], required: '8504' },
  'inverter': { forbidden: ['8501', '8419'], required: '8504' },
  'преобразователь': { forbidden: ['8501', '8419'], required: '8504' },
  'конвертер': { forbidden: ['8501', '8419'], required: '8504' },
  'converter': { forbidden: ['8501', '8419'], required: '8504' },
  // Display devices
  'monitor': { required: '8528' },
  'монитор': { required: '8528' },
  'мониторы': { required: '8528' },
  'lcd': { required: '8528' },
  'дисплей': { required: '8528' },
  'display': { required: '8528' },
  // Cleaning appliances
  'пылесос': { required: '8508' },
  'пылесосы': { required: '8508' },
  'vacuum': { required: '8508' },
  'robot': { required: '8508' },
  // Communication devices
  'телефон': { required: '8517' },
  'телефоны': { required: '8517' },
  'смартфон': { required: '8517' },
  'smartphone': { required: '8517' },
  'телефонный аппарат': { required: '8517' },
  // Computing devices
  'ноутбук': { required: '8471' },
  'laptop': { required: '8471' },
  'компьютер': { required: '8471' },
  'computer': { required: '8471' },
  'планшет': { required: '8471' },
  'tablet': { required: '8471' },
  // Imaging devices
  'камера': { required: '8525' },
  'camera': { required: '8525' },
  'видеокамера': { required: '8525' },
  'webcam': { required: '8525' },
  // Audio devices
  'наушники': { required: '8518' },
  'headphones': { required: '8518' },
  'гарнитура': { required: '8518' },
  'микрофон': { required: '8518' },
  'microphone': { required: '8518' },
  'колонки': { required: '8518' },
  'динамик': { required: '8518' },
  'speaker': { required: '8518' },
  // Input devices
  'клавиатура': { required: '8471' },
  'keyboard': { required: '8471' },
  'мышь': { required: '8471' },
  'mouse': { required: '8471' },
  // Network devices
  'роутер': { required: '8517' },
  'router': { required: '8517' },
  'маршрутизатор': { required: '8517' },
  'модем': { required: '8517' },
  'modem': { required: '8517' },
  // Solar-specific rule
  'солнечный': { forbidden: ['8419'] } // Prevent solar water heater codes for electronics
};

// Physics-First: Determine physical essence of product (not based on adjectives)
function determinePhysicalEssence(productName) {
  var essence = {
    type: null,          // e.g., static_converter, water_heater, display_device
    category: null,      // e.g., power_electronics, thermal_equipment, electronics
    function: null       // e.g., energy_conversion, heating, visual_output
  };
  
  if (!productName) {
    console.log('🔬 [Physics-First] No product name provided, returning null essence');
    return essence;
  }
  
  var name = productName.toLowerCase();
  console.log('🔬 [Physics-First] Analyzing product: ' + productName);
  
  // Classify by physical function, not adjectives
  if (name.includes('инвертор') || name.includes('inverter') || 
      name.includes('преобразователь') || name.includes('converter')) {
    essence.type = 'static_converter';
    essence.category = 'power_electronics';
    essence.function = 'energy_conversion';
    console.log('🔬 [Physics-First] Инвертор -> static_converter, power_electronics');
  } else if (name.includes('водонагреватель') || name.includes('boiler')) {
    essence.type = 'water_heater';
    essence.category = 'thermal_equipment';
    essence.function = 'heating';
    console.log('🔬 [Physics-First] Водонагреватель -> water_heater, thermal_equipment');
  } else if (name.includes('монитор') || name.includes('monitor') || name.includes('display')) {
    essence.type = 'display_device';
    essence.category = 'electronics';
    essence.function = 'visual_output';
    console.log('🔬 [Physics-First] Монитор -> display_device, electronics');
  } else if (name.includes('пылесос') || name.includes('vacuum')) {
    essence.type = 'vacuum_cleaner';
    essence.category = 'appliances';
    essence.function = 'cleaning';
    console.log('🔬 [Physics-First] Пылесос -> vacuum_cleaner, appliances');
  } else if (name.includes('телефон') || name.includes('phone') || name.includes('смартфон') || name.includes('smartphone')) {
    essence.type = 'communication_device';
    essence.category = 'electronics';
    essence.function = 'communication';
    console.log('🔬 [Physics-First] Телефон -> communication_device, electronics');
  } else if (name.includes('ноутбук') || name.includes('laptop') || name.includes('компьютер') || name.includes('computer')) {
    essence.type = 'computing_device';
    essence.category = 'electronics';
    essence.function = 'data_processing';
    console.log('🔬 [Physics-First] Ноутбук -> computing_device, electronics');
  } else if (name.includes('камера') || name.includes('camera') || name.includes('видеокамера')) {
    essence.type = 'imaging_device';
    essence.category = 'electronics';
    essence.function = 'image_capture';
    console.log('🔬 [Physics-First] Камера -> imaging_device, electronics');
  } else if (name.includes('наушники') || name.includes('headphones') || name.includes('микрофон') || name.includes('microphone')) {
    essence.type = 'audio_device';
    essence.category = 'electronics';
    essence.function = 'audio_input_output';
    console.log('🔬 [Physics-First] Наушники -> audio_device, electronics');
  } else if (name.includes('роутер') || name.includes('router') || name.includes('модем') || name.includes('modem')) {
    essence.type = 'network_device';
    essence.category = 'electronics';
    essence.function = 'network_communication';
    console.log('🔬 [Physics-First] Роутер -> network_device, electronics');
  } else if (name.includes('панель') || name.includes('panel') || 
      name.includes('модуль') || name.includes('module')) {
    if (name.includes('фотоэлектрич') || name.includes('solar') || 
        name.includes('photoelectric') || name.includes('pv')) {
      essence.type = 'photovoltaic_panel';
      essence.category = 'photoelectric_devices';
      essence.function = 'energy_conversion';
      console.log('🔬 [Physics-First] Панель/Модуль + Фотоэлектрический → photovoltaic_panel, photoelectric_devices');
    }
  } else if (name.includes('система хранения') || name.includes('energy storage') ||
      name.includes('накопитель') || name.includes('accumulator') ||
      name.includes('батарея') || name.includes('battery')) {
    essence.type = 'energy_storage';
    essence.category = 'electrical_equipment';
    essence.function = 'energy_storage';
    console.log('🔬 [Physics-First] Система хранения/Накопитель → energy_storage, electrical_equipment');
  }
  
  console.log('🔬 [Physics-First] Essence determined: ' + JSON.stringify(essence));
  return essence;
}

// Extract noun from product name for elastic search
function extractNounFromName(productName) {
  if (!productName) return null;
  
  var name = productName.toLowerCase();
  var nouns = ['панель', 'panel', 'модуль', 'module', 'инвертор', 'inverter', 
               'преобразователь', 'converter', 'камера', 'camera', 'монитор', 'monitor'];
  
  for (var i = 0; i < nouns.length; i++) {
    if (name.includes(nouns[i])) {
      return nouns[i];
    }
  }
  
  return null;
}

// Cross-category validation: reject codes that don't match physical essence
function validateCrossCategory(code, physicalEssence) {
  var first4 = code.substring(0, 4);
  var issues = [];
  
  console.log('🛡️ [Cross-Category] Validating code ' + code + ' against essence: ' + JSON.stringify(physicalEssence));
  
  if (!physicalEssence || !physicalEssence.category) {
    console.log('🛡️ [Cross-Category] No physical essence provided, skipping validation');
    return issues; // No essence to validate against
  }
  
  // Electronics cannot start with 8419 (thermal equipment)
  if (physicalEssence.category === 'electronics' || 
      physicalEssence.category === 'power_electronics') {
    if (first4 === '8419') {
      issues.push('Code ' + code + ' is thermal equipment (8419), but product is ' + physicalEssence.category);
      console.log('⛔ [Cross-Category] REJECTED thermal code 8419 for electronics/power_electronics');
    }
  }
  
  // Power electronics must start with 8504
  if (physicalEssence.type === 'static_converter') {
    if (!first4.startsWith('8504')) {
      issues.push('Code ' + code + ' does not match static converter type (must start with 8504)');
      console.log('⛔ [Cross-Category] REJECTED non-8504 code ' + first4 + ' for static converter');
    }
  }
  
  // Photovoltaic panels must be in group 8541
  if (physicalEssence.type === 'photovoltaic_panel') {
    if (!first4.startsWith('8541')) {
      issues.push('Code ' + code + ' does not match photovoltaic panel type (must start with 8541)');
      console.log('⛔ [Cross-Category] REJECTED non-8541 code ' + first4 + ' for photovoltaic panel');
    }
  }
  
  // Energy storage must be in group 8507 or 8519
  if (physicalEssence.type === 'energy_storage') {
    if (!first4.startsWith('8507') && !first4.startsWith('8519')) {
      issues.push('Code ' + code + ' does not match energy storage type (must start with 8507 or 8519)');
      console.log('⛔ [Cross-Category] REJECTED non-8507/8519 code ' + first4 + ' for energy storage');
    }
  }
  
  if (issues.length === 0) {
    console.log('✅ [Cross-Category] Code ' + code + ' PASSED cross-category validation');
  }
  
  return issues;
}

// Extract technical specifications for code selection (enhanced version)
function extractTechSpecs(productName) {
  var specs = {
    power: null,       // кВт/kW
    voltage: null,     // V
    current: null,     // A
    dimensions: null   // mm/cm
  };
  
  if (!productName) return specs;
  
  var name = productName.toLowerCase();
  
  // Extract power (кВт, kW, W)
  var powerMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:квт|kw|w)/i);
  if (powerMatch) {
    specs.power = powerMatch[1];
    console.log('🔧 [TechSpecs] Power: ' + specs.power);
  }
  
  // Extract voltage (V)
  var voltageMatch = name.match(/(\d+)\s*v/i);
  if (voltageMatch) {
    specs.voltage = voltageMatch[1];
    console.log('🔧 [TechSpecs] Voltage: ' + specs.voltage);
  }
  
  // Extract current (A)
  var currentMatch = name.match(/(\d+(?:\.\d+)?)\s*a\b/i);
  if (currentMatch) {
    specs.current = currentMatch[1];
    console.log('🔧 [TechSpecs] Current: ' + specs.current);
  }
  
  // Extract dimensions (mm, cm)
  var dimMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:mm|cm)/i);
  if (dimMatch) {
    specs.dimensions = dimMatch[1] + dimMatch[2];
    console.log('🔧 [TechSpecs] Dimensions: ' + specs.dimensions);
  }
  
  return specs;
}

// Deep search for specific codes when generic code found (NON-BLOCKING)
async function deepSearchForSpecificCode(prefix, technicalDescription, characteristics) {
  console.log('🔍 [Deep Search] Expanding prefix: ' + prefix);
  
  try {
    // Query KGD API for all 10-digit codes starting with prefix
    var apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-prefix';
    var response = await fetch(apiUrl + '?prefix=' + prefix);
    
    // Handle 405 Method Not Allowed gracefully
    if (response.status === 405) {
      console.log('⚠️ [Deep Search] 405 Method Not Allowed - API endpoint not available');
      console.log('⚠️ [Deep Search] Skipping deep search, will use found code from keden.kz');
      return null;
    }
    
    var allCodes = await response.json();
    
    // Ensure allCodes is an array before filtering
    if (!Array.isArray(allCodes)) {
      console.log('⚠️ [Deep Search] API response is not an array, using fallback');
      console.log('   API response type: ' + typeof allCodes);
      console.log('   API response: ' + JSON.stringify(allCodes).substring(0, 200));
      
      // Fallback: return known valid codes for inverters
      if (prefix === '8504') {
        console.log('🔍 [Deep Search] Using fallback code 8504408800 for static converters');
        return {
          code: '8504408800',
          description: 'Статические преобразователи для фотоэлектрических систем'
        };
      }
      
      // Fallback: return known valid codes for solar panels
      if (prefix === '8541') {
        console.log('🔍 [Deep Search] Using fallback code 8541430010 for photovoltaic panels');
        return {
          code: '8541430010',
          description: 'Солнечные фотоэлектрические панели'
        };
      }
      
      // Fallback: return known valid codes for energy storage
      if (prefix === '8507' || prefix === '8519') {
        console.log('🔍 [Deep Search] Using fallback code 8507600000 for energy storage');
        return {
          code: '8507600000',
          description: 'Литий-ионные аккумуляторы'
        };
      }
      
      return null;
    }
    
    // Filter to specific codes only (not ending in 00000)
    var specificCodes = allCodes.filter(function(c) {
      return c.code && c.code.length === 10 && !c.code.endsWith('00000');
    });
    
    console.log('🔍 [Deep Search] Found ' + specificCodes.length + ' specific codes for prefix ' + prefix);
    
    if (specificCodes.length === 0) {
      console.log('⚠️ [Deep Search] No specific codes found from KGD API, using fallback');
      
      // Fallback: return known valid codes for inverters
      if (prefix === '8504') {
        console.log('🔍 [Deep Search] Using fallback code 8504408800 for static converters');
        return {
          code: '8504408800',
          description: 'Статические преобразователи для фотоэлектрических систем'
        };
      }
      
      // Fallback: return known valid codes for solar panels
      if (prefix === '8541') {
        console.log('🔍 [Deep Search] Using fallback code 8541430010 for photovoltaic panels');
        return {
          code: '8541430010',
          description: 'Солнечные фотоэлектрические панели'
        };
      }
      
      // Fallback: return known valid codes for energy storage
      if (prefix === '8507' || prefix === '8519') {
        console.log('🔍 [Deep Search] Using fallback code 8507600000 for energy storage');
        return {
          code: '8507600000',
          description: 'Литий-ионные аккумуляторы'
        };
      }
      
      return null;
    }
    
    // AI selects best code based on characteristics
    var bestCode = await selectBestTNVEDCode(specificCodes, technicalDescription, characteristics);
    
    return bestCode;
  } catch(e) {
    console.error('❌ [Deep Search] Error:', e.message);
    
    // Fallback on error: return known valid codes for inverters
    if (prefix === '8504') {
      console.log('🔍 [Deep Search] API error, using fallback code 8504408800 for static converters');
      return {
        code: '8504408800',
        description: 'Статические преобразователи для фотоэлектрических систем'
      };
    }
    
    // Fallback on error: return known valid codes for solar panels
    if (prefix === '8541') {
      console.log('🔍 [Deep Search] API error, using fallback code 8541430010 for photovoltaic panels');
      return {
        code: '8541430010',
        description: 'Солнечные фотоэлектрические панели'
      };
    }
    
    // Fallback on error: return known valid codes for energy storage
    if (prefix === '8507' || prefix === '8519') {
      console.log('🔍 [Deep Search] API error, using fallback code 8507600000 for energy storage');
      return {
        code: '8507600000',
        description: 'Литий-ионные аккумуляторы'
      };
    }
    
    return null;
  }
}

// Verify code exists in KGD database (enhanced with better logging)
async function verifyCodeInKGD(code) {
  console.log('🔍 [KGD Verify] Checking code ' + code + ' in KGD database');
  
  try {
    var apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-code';
    var response = await fetch(apiUrl + '?code=' + code);
    
    // If 405 Method Not Allowed, try alternative endpoint
    if (response.status === 405) {
      console.log('⚠️ [KGD Verify] 405 error, trying alternative endpoint');
      apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/by-code/' + code;
      response = await fetch(apiUrl);
    }
    
    var data = await response.json();
    
    if (data.error || !data.length) {
      console.log('❌ [KGD Verify] Code ' + code + ' NOT FOUND in KGD database');
      console.log('   API response: ' + JSON.stringify(data));
      return false;
    }
    
    console.log('✅ [KGD Verify] Code ' + code + ' EXISTS in KGD database');
    if (data[0] && data[0].description) {
      console.log('   Description: ' + data[0].description);
    }
    return true;
  } catch(e) {
    console.error('❌ [KGD Verify] Error checking code ' + code + ':', e.message);
    return false;
  }
}

// Validate transport ID and document code cross-validation
function validateTransportDocument(transportId, currentDocumentCode) {
  console.log('🔍 [Transport/Doc] Validating transport ID: ' + transportId);
  
  // Detect transport type from ID format
  var transportType = null;
  var requiredDocumentCode = null;
  
  // Auto format: "XX XXX XX" or similar (digits + letters + digits)
  if (transportId && /^\d{3}\s*[A-Za-z]{2}\s*\d{2}$/.test(transportId)) {
    transportType = 'auto';
    requiredDocumentCode = '02015'; // CMR
    console.log('🔍 [Transport/Doc] Detected auto transport (XX XXX XX), requires code 02015 (CMR)');
  }
  // Container format: "TGHU8824105" or similar (7+ alphanumeric)
  else if (transportId && /^[A-Z]{4}\d{7}$/.test(transportId)) {
    transportType = 'container';
    requiredDocumentCode = '02013'; // Railway waybill
    console.log('🔍 [Transport/Doc] Detected container, requires code 02013 (Railway)');
  }
  // Wagon format: numeric
  else if (transportId && /^\d+$/.test(transportId) && transportId.length >= 8) {
    transportType = 'railway';
    requiredDocumentCode = '02013'; // Railway waybill
    console.log('🔍 [Transport/Doc] Detected railway wagon, requires code 02013 (Railway)');
  }
  
  // Validate current document code
  if (requiredDocumentCode && currentDocumentCode && currentDocumentCode !== requiredDocumentCode) {
    console.log('⚠️ [Transport/Doc] MISMATCH: transport=' + transportType + ', current doc=' + currentDocumentCode + ', required=' + requiredDocumentCode);
    return {
      valid: false,
      message: 'Код документа ' + currentDocumentCode + ' не соответствует типу транспорта ' + transportType + '. Требуется код ' + requiredDocumentCode,
      suggestedCode: requiredDocumentCode,
      transportType: transportType
    };
  }
  
  return {
    valid: true,
    suggestedCode: requiredDocumentCode,
    transportType: transportType
  };
}

// Validate packaging terminology
function validatePackaging(grossWeight, packagesCount, goodsDescription) {
  console.log('🔍 [Packaging] Validating packaging: weight=' + grossWeight + ', packages=' + packagesCount);
  
  var weight = parseFloat(grossWeight) || 0;
  var issues = [];
  
  // Check if "container" mentioned but weight < 3000kg
  if (weight > 0 && weight < 3000) {
    var hasContainerKeyword = false;
    
    // Check goods description
    if (goodsDescription && goodsDescription.toLowerCase().includes('контейнер')) {
      hasContainerKeyword = true;
    }
    
    // Check packages count description
    if (packagesCount && packagesCount.toString().toLowerCase().includes('контейнер')) {
      hasContainerKeyword = true;
    }
    
    if (hasContainerKeyword) {
      issues.push({
        type: 'packaging_terminology',
        message: 'Автоматически заменен термин "контейнер" на "места" (вес ' + weight + ' кг < 3000 кг)',
        severity: 'info',
        suggestion: 'места',
        autoReplace: true
      });
      console.log('⚠️ [Packaging] Container term used with weight < 3000kg');
    }
  }
  
  return {
    valid: issues.length === 0,
    issues: issues
  };
}

// Select code based on technical specifications match
function selectCodeByTechSpecs(candidates, techSpecs) {
  if (!techSpecs.power && !techSpecs.voltage) {
    return candidates[0]; // No specs to match
  }
  
  var bestMatch = candidates[0];
  var bestScore = 0;
  
  candidates.forEach(function(candidate) {
    var score = 0;
    var desc = (candidate.description || '').toLowerCase();
    
    // Match power in description
    if (techSpecs.power && desc.includes(techSpecs.power)) {
      score += 10;
    }
    
    // Match voltage in description
    if (techSpecs.voltage && desc.includes(techSpecs.voltage + 'v')) {
      score += 10;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  });
  
  console.log('🎯 [TechSpecs] Selected code based on specs match: ' + bestMatch.code + ' (score: ' + bestScore + ')');
  return bestMatch;
}

// Extract product characteristics for TN VED classification
function extractCharacteristics(productName) {
  var characteristics = {
    power: null,
    voltage: null,
    application: null
  };
  
  if (!productName) return characteristics;
  
  var name = productName.toLowerCase();
  
  // Extract power (e.g., 1100W, 1.1kW, 1.1кВт)
  var powerMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:w|квт|kw)/i);
  if (powerMatch) {
    characteristics.power = powerMatch[1];
    console.log('🔧 [Characteristic Extraction] Power: ' + characteristics.power);
  }
  
  // Extract voltage (e.g., 220V, 380V)
  var voltageMatch = name.match(/(\d+)\s*v/i);
  if (voltageMatch) {
    characteristics.voltage = voltageMatch[1];
    console.log('🔧 [Characteristic Extraction] Voltage: ' + characteristics.voltage);
  }
  
  // Determine application
  if (name.includes('солнечный') || name.includes('solar')) {
    characteristics.application = 'solar';
    console.log('🔧 [Characteristic Extraction] Application: solar');
  } else if (name.includes('быт') || name.includes('home')) {
    characteristics.application = 'residential';
    console.log('🔧 [Characteristic Extraction] Application: residential');
  } else if (name.includes('пром') || name.includes('industrial')) {
    characteristics.application = 'industrial';
    console.log('🔧 [Characteristic Extraction] Application: industrial');
  }
  
  return characteristics;
}

// Confidence scoring for TN VED validation
function validateTNVEDCode(code, productName, description, source) {
  var confidence = 0;
  var issues = [];

  // Check 0: Forbid generic codes ending in 5+ zeros
  if (code.endsWith('00000')) {
    issues.push('Code ' + code + ' is too generic (ends with 5+ zeros). Need specific 10-digit code from KGD database.');
    console.log('⚠️ [Validation] Generic code detected: ' + code);
  }

  // Check 1: CATEGORY_RULES validation (30 points)
  var first4 = code.substring(0, 4);
  var lowerName = productName ? productName.toLowerCase() : '';
  for (var key in CATEGORY_RULES) {
    if (lowerName.includes(key)) {
      var rule = CATEGORY_RULES[key];
      if (rule.forbidden && rule.forbidden.indexOf(first4) !== -1) {
        issues.push('Code ' + code + ' is forbidden for "' + key + '" (forbidden: ' + rule.forbidden.join(', ') + ')');
      }
      if (rule.required && !code.startsWith(rule.required)) {
        issues.push('Code ' + code + ' does not match required group ' + rule.required + ' for "' + key + '"');
      }
      if (!issues.length) {
        confidence += 30;
        console.log('✅ [Validation] Code ' + code + ' passes CATEGORY_RULES for "' + key + '"');
      }
      break;
    }
  }

  // Check 2: Code format validation (20 points)
  if (code.length === 10 && /^\d{10}$/.test(code)) {
    confidence += 20;
  } else {
    issues.push('Code format invalid: must be 10 digits');
  }

  // Check 3: Description relevance (20 points)
  if (description && description.length > 10) {
    confidence += 20;
  } else {
    issues.push('Missing or too short description');
  }

  // Check 4: Source reliability (30 points)
  if (source === 'Local') confidence += 30;
  else if (source === 'Keden') confidence += 25;
  else if (source === 'NVIDIA AI') confidence += 15;

  console.log('📊 [Validation] Code ' + code + ' - Confidence: ' + confidence + '%, Issues: ' + (issues.length || 'none'));

  return { confidence: confidence, issues: issues, valid: issues.length === 0 };
}

// Extract product characteristics (power, voltage, application) from product name
function extractCharacteristics(productName) {
  var characteristics = {
    power: null,
    voltage: null,
    application: null
  };
  
  var lowerName = productName.toLowerCase();
  
  // Extract power (e.g., 1100W, 1.1kW, 1100 Вт)
  var powerMatch = productName.match(/(\d+(?:\.\d+)?)\s*(?:W|кВт|kW|KW|Вт)/i);
  if (powerMatch) characteristics.power = powerMatch[1];
  
  // Extract voltage (e.g., 220V, 380V, 220 В)
  var voltageMatch = productName.match(/(\d+)\s*V/i);
  if (voltageMatch) characteristics.voltage = voltageMatch[1];
  
  // Determine application
  if (lowerName.includes('солнечный') || lowerName.includes('solar')) {
    characteristics.application = 'solar';
  } else if (lowerName.includes('бытовой') || lowerName.includes('домашний')) {
    characteristics.application = 'household';
  } else if (lowerName.includes('промышлен') || lowerName.includes('industrial')) {
    characteristics.application = 'industrial';
  }
  
  console.log('🔧 [Characteristic Extraction] Power: ' + (characteristics.power || 'N/A') + ', Voltage: ' + (characteristics.voltage || 'N/A') + ', Application: ' + (characteristics.application || 'N/A'));
  
  return characteristics;
}

// Validate code exists in KGD database
async function validateCodeExistsInKGD(code) {
  try {
    var apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-code';
    var response = await fetch(apiUrl + '?code=' + code);
    var data = await response.json();
    
    if (data.error || !data.content || data.content.length === 0) {
      console.log('⚠️ [KGD Validation] Code ' + code + ' not found in KGD database');
      return false;
    }
    
    console.log('✅ [KGD Validation] Code ' + code + ' exists in KGD database');
    return true;
  } catch(e) {
    console.error('❌ [KGD Validation] Error:', e.message);
    return false;
  }
}

// Vertical search: expand prefix to find specific codes
async function verticalSearch(prefix, technicalDescription) {
  console.log('🔍 [Vertical Search] Expanding prefix: ' + prefix);
  
  try {
    // Query KGD API for all codes starting with prefix
    var apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-name';
    var response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: prefix, size: 100 })
    });
    
    if (!response.ok) {
      console.log('⚠️ [Vertical Search] API returned status: ' + response.status);
      return null;
    }
    
    var data = await response.json();
    
    if (!data.content || data.content.length === 0) {
      console.log('⚠️ [Vertical Search] No results found for prefix: ' + prefix);
      return null;
    }
    
    // Filter to 10-digit codes only, exclude generic codes
    var specificCodes = data.content.filter(function(c) {
      var code = c.code || c.tnved || c.tnvedCode || c.kod;
      return code && code.length === 10 && !code.endsWith('00000');
    }).map(function(c) {
      return {
        code: c.code || c.tnved || c.tnvedCode || c.kod,
        description: c.description || c.title || c.name
      };
    });
    
    console.log('🔍 [Vertical Search] Found ' + specificCodes.length + ' specific codes for prefix ' + prefix);
    
    if (specificCodes.length === 0) {
      console.log('⚠️ [Vertical Search] No specific codes found (all are generic)');
      return null;
    }
    
    // Use AI to select best code
    var characteristics = extractCharacteristics(technicalDescription);
    var bestCode = await selectBestTNVEDCode(specificCodes, technicalDescription, characteristics);
    
    if (bestCode) {
      console.log('✅ [Vertical Search] Selected: ' + bestCode.code + ' - ' + bestCode.description);
    }
    
    return bestCode;
    
  } catch(e) {
    console.error('❌ [Vertical Search] Error:', e.message);
    return null;
  }
}

// AI Selection: Choose best TN VED code from multiple results (with physics-first logic)
async function selectBestTNVEDCode(results, technicalDescription, characteristics) {
  if (!results || results.length <= 1) {
    return results && results.length > 0 ? results[0] : null;
  }
  
  console.log('🤖 [AI Selection] Selecting best code from ' + results.length + ' candidates for: ' + technicalDescription);
  
  // Physics-First: Determine physical essence
  var physicalEssence = determinePhysicalEssence(technicalDescription);
  
  // Filter out generic codes ending in 5+ zeros
  console.log('🔍 [AI Selection] Before generic code filtering: ' + results.length + ' codes');
  var specificResults = results.filter(function(r) {
    return !r.code.endsWith('00000');
  });
  
  if (specificResults.length > 0) {
    console.log('🔍 [AI Selection] After generic code filtering: ' + specificResults.length + ' codes (filtered out ' + (results.length - specificResults.length) + ' generic codes)');
    results = specificResults;
  } else {
    console.log('⚠️ [AI Selection] All results are generic codes (ending in 00000)');
    console.log('⚠️ [AI Selection] Triggering deep search to find specific codes');
    
    // Use first code's prefix for deep search
    var prefix = results[0].code.substring(0, 4);
    console.log('🔍 [AI Selection] Using prefix ' + prefix + ' for deep search');
    
    var deepSearchResult = await deepSearchForSpecificCode(prefix, technicalDescription, characteristics);
    if (deepSearchResult && deepSearchResult.code) {
      console.log('✅ [AI Selection] Deep search found specific code: ' + deepSearchResult.code);
      return deepSearchResult;
    } else {
      console.log('⛔ [AI Selection] Deep search failed, no specific codes found');
      // Continue with generic codes as fallback
    }
  }
  
  // Apply cross-category validation to filter results
  console.log('🔍 [AI Selection] Before cross-category validation: ' + results.length + ' codes');
  if (physicalEssence && physicalEssence.category) {
    var validResults = [];
    for (var i = 0; i < results.length; i++) {
      var issues = validateCrossCategory(results[i].code, physicalEssence);
      if (issues.length === 0) {
        validResults.push(results[i]);
      } else {
        console.log('⚠️ [Physics-First] Filtered out ' + results[i].code + ': ' + issues.join(', '));
      }
    }
    if (validResults.length > 0) {
      console.log('🔍 [AI Selection] After cross-category validation: ' + validResults.length + ' codes (filtered out ' + (results.length - validResults.length) + ' invalid codes)');
      results = validResults;
    } else {
      console.log('⛔ [AI Selection] CRITICAL: All codes failed cross-category validation! REJECTING entire result set.');
      console.log('⛔ [AI Selection] This indicates a serious error - no valid codes for physical essence: ' + JSON.stringify(physicalEssence));
      // Return null to signal that no valid codes were found
      return null;
    }
  } else {
    console.log('🔍 [AI Selection] No physical essence, skipping cross-category validation');
  }
  
  // Extract technical specs for matching
  var techSpecs = extractTechSpecs(technicalDescription);
  
  // If tech specs available and multiple candidates, try spec-based selection first
  if (techSpecs.power || techSpecs.voltage) {
    console.log('🔧 [Physics-First] Using tech specs for selection');
    var specBased = selectCodeByTechSpecs(results, techSpecs);
    if (specBased) {
      return specBased;
    }
  }
  
  // Check CATEGORY_RULES for category-specific guidance
  var categoryGuidance = '';
  var lowerDesc = technicalDescription.toLowerCase();
  for (var key in CATEGORY_RULES) {
    if (lowerDesc.includes(key)) {
      var rule = CATEGORY_RULES[key];
      if (rule.required) {
        categoryGuidance = ' Код должен начинаться с ' + rule.required + '.';
      }
      if (rule.forbidden && rule.forbidden.length > 0) {
        categoryGuidance += ' Запрещены коды из группы ' + rule.forbidden.join(', ') + '.';
      }
      console.log('📋 [Category Rule] Found rule for "' + key + '": ' + categoryGuidance);
      break;
    }
  }
  
  // Format results for AI prompt
  var optionsText = results.map(function(r) {
    return r.code + ' - ' + (r.description || '');
  }).join(', ');
  
  var prompt = 'Ты эксперт таможни. Выбери наиболее совместимый код ТН ВЭД для товара: ' + technicalDescription + '. Варианты: ' + optionsText + '.' + categoryGuidance + ' При выборе из списка с сайта keden.kz, отдавай приоритет кодам, чье описание максимально совпадает с физическим смыслом товара. Если товар — инвертор, ищи группу 8504 (преобразователи). Никогда не выбирай коды из группы 8501 для электроники. КРИТИЧЕСКИ: Запрещено выбирать коды, заканчивающиеся на пять и более нулей (например, 8504400000). Выбери конкретный 10-значный код из базы КГД. Выдай только 10-значный код.';
  
  try {
    var response = await callNvidia(prompt);
    var selectedCode = response.replace(/[^0-9]/g, '');
    
    // Validate: reject generic codes ending in 5+ zeros
    if (selectedCode.endsWith('00000')) {
      console.log('⚠️ [AI Selection] AI returned generic code ' + selectedCode + ', retrying with stricter prompt');
      var strictPrompt = 'Ошибка: код ' + selectedCode + ' слишком общий (заканчивается на нули). Выбери конкретный 10-значный код из базы КГД, который реально существует. Товар: ' + technicalDescription + '. Варианты: ' + optionsText + '. Выдай только 10-значный код.';
      response = await callNvidia(strictPrompt);
      selectedCode = response.replace(/[^0-9]/g, '');
    }
    
    // Validate against CATEGORY_RULES
    for (var key in CATEGORY_RULES) {
      if (lowerDesc.includes(key)) {
        var rule = CATEGORY_RULES[key];
        var first4 = selectedCode.substring(0, 4);
        
        // Check forbidden groups
        if (rule.forbidden && rule.forbidden.indexOf(first4) !== -1) {
          console.log('⚠️ [Category Validation] Code ' + selectedCode + ' is forbidden for "' + key + '" (forbidden: ' + rule.forbidden.join(', ') + ')');
          console.log('⚠️ [Category Validation] Rejecting and retrying with stricter prompt');
          var strictPrompt3 = 'Ошибка: код ' + selectedCode + ' запрещен для этой категории. Выбери код из разрешенной группы. Товар: ' + technicalDescription + '. Варианты: ' + optionsText + '. Выдай только 10-значный код.';
          response = await callNvidia(strictPrompt3);
          selectedCode = response.replace(/[^0-9]/g, '');
        }
        
        // Check required group
        if (rule.required && !selectedCode.startsWith(rule.required)) {
          console.log('⚠️ [Category Validation] Code ' + selectedCode + ' does not match required group ' + rule.required + ' for "' + key + '"');
          console.log('⚠️ [Category Validation] Rejecting and retrying with stricter prompt');
          var strictPrompt4 = 'Ошибка: код должен начинаться с ' + rule.required + '. Выбери правильный код. Товар: ' + technicalDescription + '. Варианты: ' + optionsText + '. Выдай только 10-значный код.';
          response = await callNvidia(strictPrompt4);
          selectedCode = response.replace(/[^0-9]/g, '');
        }
      }
    }
    
    // Find the selected code in results
    var selected = results.find(function(r) { return r.code === selectedCode; });
    if (selected) {
      console.log('✅ [AI Selection]: Chose ' + selectedCode + ' (' + selected.description + ') from ' + results.length + ' candidates');
      return selected;
    }
    
    // If AI selection fails, return first result
    console.log('⚠️ [AI Selection] AI returned code not in results, using first result');
    return results[0];
  } catch(e) {
    console.error('❌ [AI Selection] Failed:', e.message);
    return results[0];
  }
}

// NVIDIA LLM TN VED classification
async function classifyWithNvidia(goodsName) {
  console.log('🤖 [AI Fallback] Using NVIDIA AI to classify: ' + goodsName);
  var prompt = 'Определи 10-значный код ТН ВЭД для товара: ' + goodsName + '. Используй официальную номенклатуру ТН ВЭД РК. Output ONLY the 10-digit code. No spaces, no dots, no words.';
  
  try {
    var response = await callNvidia(prompt);
    // Clean up markdown and extract only digits
    var cleanedCode = response.replace(/[^0-9]/g, '');
    
    // Pad with zeros if less than 10 digits (e.g., "8508" -> "8508000000")
    if (cleanedCode.length < 10 && cleanedCode.length > 0) {
      cleanedCode = cleanedCode.padEnd(10, '0');
      console.log('📝 [AI Fallback] Padded code to 10 digits: ' + cleanedCode);
    }
    
    if (cleanedCode.length === 10) {
      console.log('✅ [AI Fallback]: Generated code ' + cleanedCode + ' for "' + goodsName + '"');
      return {
        code: cleanedCode,
        description: 'Код определен ИИ (требует проверки)',
        status: 'ai_determined',
        source: 'NVIDIA AI'
      };
    } else {
      console.log('⚠️ [AI Fallback] Invalid code format: ' + cleanedCode);
      throw new Error('Invalid code format from NVIDIA AI');
    }
  } catch(e) {
    console.error('❌ [AI Fallback] Classification failed:', e.message);
    throw e;
  }
}

// Get exchange rate from National Bank of Kazakhstan
function getExchangeRate(currency) {
  return new Promise(function(resolve, reject) {
    if (currency === 'KZT') {
      resolve({ rate: 1, currency: 'KZT' });
      return;
    }

    var url = 'https://nationalbank.kz/rss/rates_all.xml';
    
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var rateMatch = data.match(new RegExp('<title>' + currency + '</title>.*?<description>([\\d.]+)</description>', 's'));
          if (rateMatch) {
            var rate = parseFloat(rateMatch[1]);
            resolve({ rate: rate, currency: currency });
          } else {
            reject(new Error('Курс валюты ' + currency + ' не найден'));
          }
        } catch(e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Get duty rate based on TN VED code
function getDutyRate(tnvedCode) {
  if (!tnvedCode || tnvedCode.length < 4) return { dutyRate: 0, vatRate: 12, exciseRate: 0 };

  // Extract first 4 digits for duty rate determination
  var first4 = tnvedCode.substring(0, 4);

  // Default rates
  var dutyRate = 10;
  var vatRate = 12;
  var exciseRate = 0;

  // Additive manufacturing machines (8485 20 000 0) - 0% duty
  if (tnvedCode.startsWith('8485') || first4 === '8485') {
    dutyRate = 0;
  }
  // Other electronics (0% duty)
  else if (first4.startsWith('85') || first4.startsWith('84')) {
    dutyRate = 0;
  }

  // Clothing (10% duty)
  if (first4.startsWith('61') || first4.startsWith('62')) {
    dutyRate = 10;
  }

  // Footwear (10% duty)
  if (first4.startsWith('64')) {
    dutyRate = 10;
  }

  return { dutyRate: dutyRate, vatRate: vatRate, exciseRate: exciseRate };
}

// Calculate customs payments
function calculateCustomsPayments(invoiceAmount, exchangeRate, goods, deliveryTerms) {
  // Hardcode Kazakhstan VAT rate to 12%
  const VAT_RATE = 0.12;

  if (!invoiceAmount || !exchangeRate) {
    return {
      dutyAmount: 0,
      vatAmount: 0,
      exciseAmount: 0,
      totalAmount: 0,
      dutyRate: 0,
      vatRate: 12,
      exciseRate: 0
    };
  }

  // Use the first TN VED code for duty rate
  var firstTnved = (goods && goods.length > 0) ? (goods[0].tnved_code || goods[0].tnved || '') : '';
  var rates = getDutyRate(firstTnved);

  var customsValueKZT = parseFloat(invoiceAmount) * parseFloat(exchangeRate);

  // DDP Logic: Customs value = Invoice value - (Duties + Taxes)
  if (deliveryTerms && deliveryTerms.toUpperCase() === 'DDP') {
    console.log('🔍 [DDP] Detected DDP terms - adjusting customs value calculation');
    
    // Estimate duties and taxes (default: 20% total)
    var estimatedTaxRate = 0.20; // 10% duty + 10% estimate
    var estimatedTaxes = customsValueKZT * estimatedTaxRate;
    
    customsValueKZT = customsValueKZT - estimatedTaxes;
    console.log('🔍 [DDP] Original invoice value: ' + (parseFloat(invoiceAmount) * parseFloat(exchangeRate)).toFixed(2));
    console.log('🔍 [DDP] Estimated taxes (20%): ' + estimatedTaxes.toFixed(2));
    console.log('🔍 [DDP] Adjusted customs value: ' + customsValueKZT.toFixed(2));
  }

  // Hard constraint: KZT-only base
  if (exchangeRate < 10) {
    console.log('🛑 [CRITICAL CHECK] Exchange rate invalid (' + exchangeRate + '). Must use KZT base. Recalculating...');
    throw new Error('CRITICAL: Exchange rate invalid (' + exchangeRate + '). Must use KZT base.');
  }
  if (customsValueKZT < 1000 && parseFloat(invoiceAmount) > 1000) {
    console.log('🛑 [CRITICAL CHECK] Base amount in USD detected. Forcing KZT base calculation...');
    throw new Error('CRITICAL: Base amount in USD detected. Forcing KZT base calculation.');
    customsValueKZT = parseFloat(invoiceAmount) * 477.49; // Fallback rate
  }
  console.log('✅ [CRITICAL CHECK] Base: KZT? Yes (customsValueKZT=' + customsValueKZT + ')');

  var dutyAmount = customsValueKZT * (rates.dutyRate / 100);
  var vatAmount = (customsValueKZT + dutyAmount) * VAT_RATE;
  var exciseAmount = 0;

  // Calculate excise tax if applicable
  if (rates.exciseRate > 0) {
    exciseAmount = customsValueKZT * (rates.exciseRate / 100);
  }

  var totalAmount = dutyAmount + vatAmount + exciseAmount;

  console.log('✅ [CRITICAL CHECK] VAT: 12%? Yes');

  return {
    dutyRate: rates.dutyRate,
    vatRate: 12, // Always 12% for Kazakhstan
    exciseRate: rates.exciseRate,
    dutyAmount: dutyAmount.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    exciseAmount: exciseAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2)
  };
}

// Validate data before PDF generation
function validateData(data) {
  var errors = [];
  var warnings = [];

  // Create global DECLARANT_ID for single source of truth
  var DECLARANT_ID = data.declarant_inn;
  if (DECLARANT_ID) {
    // Ensure all BIN fields use the same value
    data.declarant_inn = DECLARANT_ID;
    console.log('✅ [BIN Validation] DECLARANT_ID set: ' + DECLARANT_ID);
  }

  // Create single source of truth for gross weight
  var GROSS_WEIGHT_SOURCE = data.gross_weight;
  if (GROSS_WEIGHT_SOURCE) {
    // Ensure all weight fields use the same value
    data.gross_weight = GROSS_WEIGHT_SOURCE;
    // Also sync financial_doc if it contains weight data
    if (data.financial_doc && data.financial_doc.match(/\d+/)) {
      var weightInFinancial = data.financial_doc.match(/\d+/)[0];
      if (parseFloat(weightInFinancial) !== parseFloat(GROSS_WEIGHT_SOURCE)) {
        console.log('⚠️ [Weight Sync] financial_doc has different weight: ' + weightInFinancial + ' vs ' + GROSS_WEIGHT_SOURCE);
        // Keep financial_doc as is for now, but log the discrepancy
      }
    }
    console.log('✅ [Weight Sync] GROSS_WEIGHT_SOURCE set: ' + GROSS_WEIGHT_SOURCE + ' kg');
  }

  // Debug: Check packages_count
  console.log('🔍 [Debug] packages_count: "' + data.packages_count + '", packaging_type: "' + data.packaging_type + '"');
  if (!data.packages_count) {
    console.log('⚠️ [Debug] packages_count is empty or missing');
  }

  // Validate exporter_country is a valid country code, not declarant data
  if (data.exporter_country && data.exporter_country.length > 3) {
    console.log('⚠️ [Validation] exporter_country looks invalid: "' + data.exporter_country + '" (too long for country code)');
    
    var countryText = data.exporter_country.toString();
    
    // Check if it contains declarant info (forbidden)
    if (data.declarant_name && countryText.toLowerCase().includes(data.declarant_name.toLowerCase())) {
      console.log('⚠️ [Field 15] exporter_country contains declarant name, using default CN');
      data.exporter_country = 'CN';
    } else {
      // Extract country code from end of string
      var countryMatch = countryText.match(/(CN|US|RU|KZ|TR|AE|DE|GB|FR|IT|ES|PL|NL|BE|AT|CH|SE|NO|DK|FI|JP|KR|IN|BR|AR|CL|PE|MX|ZA|AU|CA|SG|MY|TH|VN|ID|PH)$/i);
      if (countryMatch) {
        data.exporter_country = countryMatch[1].toUpperCase();
        console.log('✅ [Field 15] Country code extracted from end: ' + data.exporter_country);
      } else {
        // Try to find anywhere if not at end
        var anyMatch = countryText.match(/\b(CN|US|RU|KZ|TR|AE|DE|GB|FR|IT|ES|PL|NL|BE|AT|CH|SE|NO|DK|FI|JP|KR|IN|BR|AR|CL|PE|MX|ZA|AU|CA|SG|MY|TH|VN|ID|PH)\b/i);
        if (anyMatch) {
          data.exporter_country = anyMatch[1].toUpperCase();
          console.log('✅ [Field 15] Country code extracted: ' + data.exporter_country);
        } else {
          data.exporter_country = 'CN';
          console.log('✅ [Field 15] Defaulting to CN');
        }
      }
    }
  }

  // DDP reverse calculation logic
  if (data.delivery_terms && data.delivery_terms.toUpperCase() === 'DDP') {
    var invoiceAmount = parseFloat(data.total_invoice_amount) || 0;
    var customsValue = parseFloat(data.customs_value) || invoiceAmount; // Default to invoice if not set

    // If customs value equals invoice amount with DDP, it's an error
    if (Math.abs(customsValue - invoiceAmount) < 0.01) {
      console.log('⚠️ [DDP] Customs value equals invoice amount. Need reverse calculation.');
      // Calculate taxes and remove from base
      var dutyRate = 0.05; // 5% duty (example)
      var vatRate = 0.12; // 12% VAT
      var duty = invoiceAmount * dutyRate;
      var vat = (invoiceAmount - duty) * vatRate;
      var correctedCustomsValue = invoiceAmount - duty - vat;
      data.customs_value = correctedCustomsValue.toFixed(2);
      console.log('✅ [DDP] Reverse calculation: Customs value corrected to ' + data.customs_value + ' (removed ' + (duty + vat).toFixed(2) + ' in taxes)');
    }
  }

  // Check for required fields (TN VED codes are now always provided by autonomous system)
  if (!data.declarant_name) errors.push('Не указано название декларанта');
  if (!data.declarant_inn) errors.push('Не указан БИН/ИИН декларанта');
  if (!data.exporter_name) errors.push('Не указано название экспортера');
  if (!data.exporter_country) errors.push('Не указана страна экспортера');
  if (!data.total_invoice_amount) errors.push('Не указана сумма инвойса');
  if (!data.currency) errors.push('Не указана валюта');

  // Validate transport/document cross-validation with string normalization
  if (data.transport_id) {
    var transportId = data.transport_id.toString().trim().replace(/\s+/g, ' ');
    
    // Auto detection based on format
    if (/^\d{3}\s*[A-Za-z]{2}\s*\d{2}$/.test(transportId)) {
      data.document_code = '02015'; // CMR for auto
      console.log('✅ [Transport] Auto transport detected → 02015');
    } else if (/^[A-Z]{4}\d{7}$/.test(transportId) || /^\d{8,}$/.test(transportId)) {
      data.document_code = '02013'; // Railway
      console.log('✅ [Transport] Railway detected → 02013');
    } else {
      errors.push('Не удалось определить тип транспорта для кода документа. Пожалуйста, укажите: Авто или Ж/Д?');
    }
  }

  // Auto-replace packaging terminology
  if (data.packages_count && data.packages_count.toString().toLowerCase().includes('контейнер')) {
    var weight = parseFloat(data.gross_weight) || 0;
    if (weight > 0 && weight < 3000) {
      data.packages_count = data.packages_count.toString().replace(/контейнер/gi, 'места');
      console.log('✅ [Auto-replace] "контейнер" → "места" (weight=' + weight + 'kg)');
    }
  }

  // Validate packaging terminology
  if (data.gross_weight && data.packages_count) {
    var goodsDescription = (data.goods && data.goods.length > 0) ? data.goods[0].name : '';
    var packagingValidation = validatePackaging(data.gross_weight, data.packages_count, goodsDescription);
    if (!packagingValidation.valid) {
      packagingValidation.issues.forEach(function(issue) {
        if (issue.severity === 'warning') {
          warnings.push(issue.message);
        } else if (issue.severity === 'info') {
          warnings.push(issue.message);
        } else {
          errors.push(issue.message);
        }
      });
    }
  }

  // Cross-summation weight validation
  if (data.goods && data.goods.length > 0 && data.gross_weight) {
    var calculatedTotalGross = data.goods.reduce(function(s, item) {
      return s + (parseFloat(item.gross_weight) || 0);
    }, 0);
    var declaredTotalGross = parseFloat(data.gross_weight) || 0;

    if (Math.abs(calculatedTotalGross - declaredTotalGross) > 0.1) {
      errors.push('Несоответствие веса: Сумма брутто товаров (' + calculatedTotalGross + ' кг) не совпадает с общим брутто (' + declaredTotalGross + ' кг)');
    }
  }

  // Net weight validation with packaging type check and absolute floor
  if (data.goods && data.goods.length > 0) {
    data.goods.forEach(function(item) {
      if (item.gross_weight && item.net_weight) {
        var gross = parseFloat(item.gross_weight);
        var net = parseFloat(item.net_weight);
        var packaging = (item.packaging_type || data.packaging_type || '').toLowerCase();

        // Absolute floor check
        if (gross > 100 && net < 1) {
          errors.push('Вес нетто (' + net + ' кг) не может быть < 1 кг при брутто ' + gross + ' кг. Уточните вес нетто.');
        }

        // Packaging-specific validation
        var ratio = net / gross;
        if (packaging.includes('контейнер') || packaging.includes('container')) {
          // Container allows larger difference
          if (ratio < 0.6) {
            errors.push('Вес нетто (' + net + ' кг) менее 60% от брутто (' + gross + ' кг) для контейнера. Уточните вес.');
          }
        } else {
          // Pallet/box requires tighter tolerance
          if (ratio < 0.8) {
            errors.push('Вес нетто (' + net + ' кг) менее 80% от брутто (' + gross + ' кг) для паллет/коробок. Уточните вес нетто.');
          }
        }
      }
    });
  }

  // Log warnings
  if (warnings.length > 0) {
    console.log('⚠️ [Validation] Warnings:');
    warnings.forEach(function(w) { console.log('  - ' + w); });
  }

  if (errors.length > 0) {
    throw new Error('Валидация не пройдена:\n' + errors.join('\n'));
  }

  return true;
}

// PDF generation
function generatePDF(data) {
  // Validate data before generating PDF
  validateData(data);

  function g(key) { return (data[key] || '').toString(); }

  var today = new Date().toLocaleDateString('ru-RU');
  var regNum = g('ref_number') || ('55302/' + new Date().toLocaleDateString('ru-RU').replace(/\./g,'') + '/' + Math.floor(Math.random()*9999999).toString().padStart(7,'0'));

  var goodsRows = (data.goods || []).map(function(item, i) {
    var totalP = parseFloat(item.total_price) || 0;
    var field31Content = item.name || '';
    // Add packaging type to Field 31 if available
    if (data.packaging_type && !field31Content.toLowerCase().includes(data.packaging_type.toLowerCase())) {
      field31Content += ' (' + data.packaging_type + ')';
    }
    return '<tr>' +
      '<td style="text-align:center">' + (i+1) + '</td>' +
      '<td>' + field31Content + '</td>' +
      '<td style="text-align:center;font-weight:bold">' + (item.tnved || item.tnved_code || '') + '</td>' +
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
  var invoiceAmount = parseFloat(g('total_invoice_amount')) || parseFloat(totalPrice);
  var exchangeRate = parseFloat(g('exchange_rate')) || 1;
  var totalPriceKZT = (invoiceAmount * exchangeRate).toFixed(2);

  console.log('🔍 Debug calculation:');
  console.log('  invoiceAmount (raw):', g('total_invoice_amount'));
  console.log('  invoiceAmount (parsed):', invoiceAmount);
  console.log('  exchangeRate:', exchangeRate);
  console.log('  totalPriceKZT:', totalPriceKZT);
  console.log('  totalPriceKZT type:', typeof totalPriceKZT);
  console.log('  totalPriceKZT length:', totalPriceKZT.length);
  console.log('  totalPriceKZT first char:', totalPriceKZT.charAt(0));

  var customsPayments = calculateCustomsPayments(invoiceAmount, exchangeRate, data.goods, data.delivery_terms);
  console.log('💰 Расчет платежей: пошлина ' + customsPayments.dutyRate + '%, НДС ' + customsPayments.vatRate + '%');

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

    + '<div class="title-row">'
    + '<div style="font-size:6pt">1 ДЕКЛАРАЦИЯ<br><span style="font-size:8pt;font-weight:bold">ИМ 40</span></div>'
    + '<div class="main-title">ДЕКЛАРАЦИЯ НА ТОВАРЫ</div>'
    + '<div class="reg-num">Рег. № ДТ<br><strong>' + regNum + '</strong></div>'
    + '</div>'

    + '<table><tr>'
    + '<td style="width:30%"><div class="field-label">2 Отправитель/Экспортер</div><div class="field-value">' + g('exporter_name') + '<br>' + g('exporter_country') + '<br>' + g('exporter_address') + '</div></td>'
    + '<td style="width:8%"><div class="field-label">3 Формы</div><div class="field-value">1</div><div class="field-label">4 Отгр.</div></td>'
    + '<td style="width:8%"><div class="field-label">5 Всего т-ов</div><div class="field-value">' + (data.goods||[]).length + '</div></td>'
    + '<td style="width:8%"><div class="field-label">6 Всего мест</div><div class="field-value">' + Number(g('packages_count') || 0) + '</div></td>'
    + '<td style="width:20%"><div class="field-label">7 Справочный номер</div><div class="field-value">' + regNum + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:35%"><div class="field-label">8 Получатель &nbsp; № ' + g('declarant_inn') + '</div><div class="field-value">' + g('declarant_name') + '<br>' + g('declarant_address') + '</div></td>'
    + '<td style="width:35%"><div class="field-label">9 Лицо, ответственное за финансовое урегулирование &nbsp; № ' + g('declarant_inn') + '</div><div class="field-value">' + g('declarant_name') + '<br>' + g('declarant_address') + '</div></td>'
    + '<td style="width:10%"><div class="field-label">11 Торг.страна</div><div class="field-value">' + g('exporter_country') + '</div></td>'
    + '<td style="width:20%"><div class="field-label">12 ОБЩАЯ ТАМОЖЕННАЯ СТОИМОСТЬ</div><div class="field-value">' + totalPriceKZT + ' KZT</div></td>'
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
    + '<td style="width:15%"><div class="field-label">22 Валюта и сумма по счету</div><div class="field-value">' + g('currency') + ' ' + g('total_invoice_amount') + '<br>(' + totalPriceKZT + ' KZT)</div></td>'
    + '<td style="width:8%"><div class="field-label">23 Курс валюты</div><div class="field-value">' + g('exchange_rate') + '</div></td>'
    + '<td style="width:7%"><div class="field-label">25 Вид</div><div class="field-value">' + g('transport_type') + '</div></td>'
    + '<td style="width:10%"><div class="field-label">35 Вес брутто общий</div><div class="field-value">' + totalWeight + ' кг</div></td>'
    + '<td style="width:10%"><div class="field-label">28 Финансовые сведения</div><div class="field-value">' + g('financial_doc') + '</div></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:25%"><div class="field-label">29 Орган въезда/выезда</div><div class="field-value">' + g('border_crossing') + '</div></td>'
    + '<td style="width:25%"><div class="field-label">30 Местонахождение товаров</div></td>'
    + '<td style="width:25%"><div class="field-label">6 Всего мест / 27 Место погрузки</div><div class="field-value">' + (g('packages_count') ? Number(g('packages_count')) + ' мест' : '') + '</div></td>'
    + '<td style="width:25%"><div class="field-label">Инвойс / Контракт</div><div class="field-value">' + g('invoice_number') + ' от ' + g('invoice_date') + '<br>' + g('contract_number') + '</div></td>'
    + '</tr></table>'

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

    + '<table><tr>'
    + '<td style="width:60%"><div class="field-label">44 Дополнительная информация / Представленные документы</div>'
    + '<div class="field-value">'
    + (g('financial_doc') ? g('financial_doc') + '<br>' : '')
    + (g('document_code') ? g('document_code') + '<br>' : '')
    + '04021 &nbsp; ' + g('invoice_number') + ' от ' + g('invoice_date') + ' Счет-фактура (инвойс)<br>'
    + '03011 &nbsp; ' + g('contract_number') + ' Договор (контракт)'
    + '</div></td>'
    + '<td style="width:40%">'
    + '<div class="field-label">47 Исчисление платежей</div>'
    + '<table style="margin:0"><tr><th>Вид</th><th>Основа начисления</th><th>Ставка</th><th>Сумма</th><th>СП</th></tr>'
    + '<tr><td>1010</td><td>' + totalPriceKZT + ' тг</td><td>25950 тг</td><td>25950 тг</td><td>ИУ</td></tr>'
    + '<tr><td>2010</td><td>' + totalPriceKZT + ' тг</td><td>' + customsPayments.dutyRate + '%</td><td>' + customsPayments.dutyAmount + ' тг</td><td>ИУ</td></tr>'
    + '<tr><td>5060</td><td>' + totalPriceKZT + ' тг</td><td>12%</td><td>' + customsPayments.vatAmount + ' тг</td><td>ИУ</td></tr>'
    + '</table></td>'
    + '</tr></table>'

    + '<table><tr>'
    + '<td style="width:40%"><div class="field-label">54 Место и дата</div><div class="field-value">' + today + '</div></td>'
    + '<td style="width:60%"><div class="field-label">Подпись и ФИО декларанта</div><div class="field-value">' + g('declarant_name') + '</div></td>'
    + '</tr></table>'

    + '<div style="border:1px solid #000;padding:2mm;margin-top:2mm;min-height:15mm">'
    + '<div class="field-label">D Контроль в пункте назначения / Штамп:</div>'
    + '</div>'

    + '</div></body></html>';

  var htmlPath = path.join(__dirname, 'dt_' + Date.now() + '.html');
  var pdfPath = htmlPath.replace('.html', '.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');

  return new Promise(function(resolve, reject) {
    var pyScript = htmlPath.replace('.html', '.py');
    var pyLines = [];
    pyLines.push('from weasyprint import HTML');
    pyLines.push('HTML(filename=' + JSON.stringify(htmlPath) + ').write_pdf(' + JSON.stringify(pdfPath) + ')');
    fs.writeFileSync(pyScript, pyLines.join('\n'));
    require('child_process').exec('python3 ' + JSON.stringify(pyScript), function(err) {
      try {
        fs.unlinkSync(pyScript);
      } catch(e) {
        console.log('⚠️ Не удалось удалить временный Python файл:', e.message);
      }
      try {
        fs.unlinkSync(htmlPath);
      } catch(e) {
        console.log('⚠️ Не удалось удалить временный HTML файл:', e.message);
      }
      if (err) reject(new Error('WeasyPrint: ' + err.message));
      else resolve(pdfPath);
    });
  });
}

// Handle /ask command with AI
async function handleAskCommand(question) {
  var lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes('форм') && (lowerQuestion.includes('сн') || lowerQuestion.includes('отправ') || lowerQuestion.includes('еще'))) {
    return generateDeclarationMessage();
  }
  
  if (lowerQuestion.includes('бин') || lowerQuestion.includes('инн')) {
    return '🔢 БИН/ИИН - это 12-значный идентификационный номер компании или ИП. Если вы физическое лицо, используйте ваш ИИН.';
  }
  
  if (lowerQuestion.includes('экспорт') || lowerQuestion.includes('отправит')) {
    return '📤 Экспортер - это компания или лицо, из которой отправляется товар. Укажите название компании и страну отправления (например: Китай, Турция, ОАЭ).';
  }
  
  if (lowerQuestion.includes('инвойс') || lowerQuestion.includes('счет')) {
    return '🧾 Инвойс - это счет-фактура от поставщика. Укажите номер инвойса, дату, сумму и валюту.';
  }

  try {
    var answer = await callNvidia('Ты эксперт по таможенным декларациям. Отвечай на вопросы клиента о процессе оформления декларации, необходимых документах, правилах заполнения и т.д. Отвечай кратко и по делу.\n\nВопрос клиента: ' + question);
    return answer;
  } catch(e) {
    console.error('❌ Ошибка /ask:', e.message);
    return '⚠️ Сервис ИИ временно недоступен. Попробуйте позже или напишите кодовое слово "' + KEYWORD_DYNAMIC + '" чтобы начать заполнение декларации.';
  }
}

// Preprocess search query to remove brand names and focus on product type
function preprocessSearchQuery(goodsName) {
  var query = goodsName.toLowerCase();
  
  // Common brand names to remove (both English and Russian)
  var brands = [
    'xiaomi', 'samsung', 'apple', 'sony', 'lg', 'philips', 'panasonic',
    'bosch', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'msi',
    'nokia', 'motorola', 'huawei', 'oppo', 'vivo', 'oneplus',
    'samsung', 'lg', 'sony', 'philips', 'panasonic', 'bosch',
    'dell', 'hp', 'lenovo', 'asus', 'acer', 'msi',
    'sungrow', 'huawei', 'zte', 'byd', 'longi', 'jinko',
    'trina', 'ja solar', 'canadian solar', 'first solar'
  ];
  
  // Remove brand names
  for (var i = 0; i < brands.length; i++) {
    var brandRegex = new RegExp('\\b' + brands[i] + '\\b', 'gi');
    query = query.replace(brandRegex, '');
  }
  
  // Remove model numbers (patterns like SG110CX, MI-123, etc.)
  query = query.replace(/\b[A-Z]{2,}\d{3,}[A-Z]*\d*\b/g, '');
  query = query.replace(/\b[A-Z]{1,2}\d{3,}\b/g, '');
  
  // Clean up extra spaces
  query = query.replace(/\s+/g, ' ').trim();
  
  // If query is too short after cleaning, use original
  if (query.length < 3) {
    console.log('⚠️ [Query Preprocessing] Query too short after cleaning, using original');
    return goodsName;
  }
  
  console.log('🔧 [Query Preprocessing] Original: "' + goodsName + '" → Cleaned: "' + query + '"');
  return query;
}

// TN VED search with tnved.info as primary source, keden.kz as fallback
// Simplified: takes first code from tnved.info, only uses synonyms if first search fails
async function searchKeden(goodsName) {
  console.log('🔍 Searching TN VED code for: ' + goodsName);
  
  // Step 1: Try tnved.info first (primary source)
  try {
    var tnvedInfoFetcher = require('./tnved_info_fetcher.js');
    console.log('🔍 [Primary] Searching tnved.info for: ' + goodsName);
    var tnvedResult = await tnvedInfoFetcher.searchTnvedInfo(goodsName);
    
    if (tnvedResult && tnvedResult.code) {
      console.log('✅ [Primary] Found code on tnved.info: ' + tnvedResult.code);
      return [{
        code: tnvedResult.code,
        description: tnvedResult.description || 'Описание с tnved.info',
        source: 'tnved.info',
        status: 'official'
      }];
    } else {
      console.log('⚠️ [Primary] No code found on tnved.info, trying synonyms...');
      
      // Step 2: Try synonyms only if first search failed
      var variations = tnvedInfoFetcher.generateSearchVariations(goodsName);
      
      for (var v = 1; v < variations.length; v++) { // Skip first (original query)
        console.log('🔍 [Synonym] Trying variation ' + (v + 1) + '/' + variations.length + ': ' + variations[v]);
        var synonymResult = await tnvedInfoFetcher.searchTnvedInfo(variations[v]);
        
        if (synonymResult && synonymResult.code) {
          console.log('✅ [Synonym] Found code with synonym: ' + synonymResult.code);
          return [{
            code: synonymResult.code,
            description: synonymResult.description || 'Описание с tnved.info',
            source: 'tnved.info',
            status: 'official'
          }];
        }
      }
      
      console.log('⚠️ [Synonym] No code found with synonyms, falling back to keden.kz...');
    }
  } catch(tnvedError) {
    console.error('❌ [tnved.info] Search failed:', tnvedError.message);
    console.log('📡 Fallback to keden.kz...');
  }
  
  // Step 3: Fallback to keden.kz if tnved.info fails
  var cleanedQuery = preprocessSearchQuery(goodsName);
  console.log('🔍 [Fallback] Поиск ТН ВЭД через Python API: ' + cleanedQuery);
  
  try {
    // Вызываем Python API вместо прямого запроса к keden.kz
    var response = await fetch('http://localhost:5001/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: cleanedQuery
      })
    });
    
    if (!response.ok) {
      throw new Error('Python API returned status: ' + response.status);
    }
    
    var data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    // Форматируем результат в ожидаемом формате
    var results = [{
      code: data.code,
      description: data.description
    }];
    
    console.log('✅ [Fallback] Python API вернул код: ' + data.code);
    return results;
    
  } catch (error) {
    console.error('❌ [Fallback] Ошибка Python API:', error.message);
    // Fallback на старый метод если Python API недоступен
    console.log('📡 [Fallback] Fallback на старый метод (прямой запрос к keden.kz)');
    return await searchKedenFallback(goodsName);
  }
}

// Fallback функция для прямого запроса к keden.kz
async function searchKedenFallback(goodsName) {
  var apiUrl = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-name';
  var maxAttempts = 5;
  var attempt = 0;
  var results = [];
  var originalName = goodsName;
  var query = goodsName.toLowerCase();

  console.log('🔍 Starting TN VED search (fallback) for:', goodsName);
  
  // AI Pre-Analysis: Convert commercial name to technical description
  var technicalDescription = await convertToTechnicalDescription(goodsName);
  console.log('📋 [Keden Search] Using technical description: ' + technicalDescription);
  
  // Use technical description for search instead of commercial name
  query = technicalDescription.toLowerCase();

  // Helper function to wrap fetch with timeout
  function fetchWithTimeout(url, options, timeoutMs) {
    return Promise.race([
      fetch(url, options),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('Request timeout')); }, timeoutMs);
      })
    ]);
  }

  // Generate search phrase variations (multi-level search)
  function generateSearchVariations(originalQuery) {
    var variations = [];

    // 1. Exact name (technical description)
    variations.push(originalQuery);

    // 2. Extract keywords (remove common words, keep technical terms)
    var keywords = query.split(/\s+/).filter(function(word) {
      var stopWords = ['для', 'и', 'в', 'на', 'с', 'по', 'к', 'от', 'из', 'или', 'а', 'но', 'же'];
      return word.length > 2 && !stopWords.includes(word);
    });

    // 3. Try first keyword
    if (keywords.length > 0) {
      variations.push(keywords[0]);
    }

    // 4. Try first two keywords combined
    if (keywords.length >= 2) {
      variations.push(keywords[0] + ' ' + keywords[1]);
    }

    // 5. Try specific synonyms based on product type
    if (query.includes('3d') || query.includes('принтер') || query.includes('аддитив')) {
      variations.push('3d-принтер');
      variations.push('аддитивное производство');
      variations.push('принтер');
      variations.push('машина для аддитивного производства');
    }

    if (query.includes('пылесос') || query.includes('vacuum') || query.includes('robot')) {
      variations.push('пылесос');
      variations.push('робот-пылесос');
      variations.push('пылесос со встроенным двигателем');
      variations.push('бытовая техника');
    }

    if (query.includes('сушил') || query.includes('dryer')) {
      variations.push('сушилка');
      variations.push('сушильная камера');
      variations.push('сушка');
    }

    if (query.includes('футбол') || query.includes('трикот') || query.includes('рубаш')) {
      variations.push('рубашка');
      variations.push('футболка');
      variations.push('трикотаж');
      variations.push('одежда');
    }

    if (query.includes('ноутбук') || query.includes('laptop') || query.includes('компьютер') || query.includes('computer') || query.includes('pc')) {
      variations.push('ноутбук');
      variations.push('компьютер');
      variations.push('персональный компьютер');
      variations.push('portable computer');
      variations.push('notebook computer');
    }

    // MONITORS - Add substring search for monitors
    if (query.includes('монитор') || query.includes('monitor') || query.includes('lcd') || query.includes('display')) {
      variations.push('монитор');
      variations.push('lcd монитор');
      variations.push('компьютерный монитор');
      variations.push('дисплей');
      variations.push('8528'); // TN VED code for monitors
    }

    // Smart watches - prioritize 9102 (electronic watches) over 8517 (communication devices)
    if (query.includes('час') || query.includes('watch') || query.includes('смарт')) {
      variations.push('наручные часы');
      variations.push('электронные часы');
      variations.push('9102');
    }

    // Solar panels - prioritize 8541 (photoelectric modules)
    if (query.includes('солнеч') || query.includes('solar') || query.includes('панель') || query.includes('panel')) {
      variations.push('фотоэлектрические модули');
      variations.push('солнечная панель');
      variations.push('8541');
    }

    // EVA materials - prioritize 3926 (plastic products)
    if (query.includes('eva') || query.includes('коврик') || query.includes('mat')) {
      variations.push('изделия из пластмасс');
      variations.push('полимерные покрытия');
      variations.push('3926');
    }

    // Dietary supplements - prioritize 2106 (food supplements) over 3004 (medicines)
    if (query.includes('бад') || query.includes('биологически активная добавка') || query.includes('витамин') || query.includes('supplement')) {
      variations.push('биологически активные добавки');
      variations.push('пищевые добавки');
      variations.push('2106');
    }

    // LED grow lights - prioritize 9405 (luminaires) over 8539 (lamps)
    if (query.includes('led') || query.includes('светильник') || query.includes('растени') || query.includes('grow')) {
      variations.push('светодиодные светильники');
      variations.push('осветительные приборы');
      variations.push('9405');
    }

    // Coolers with compressor - prioritize 8418 (refrigerators) over 8414 (compressors)
    if (query.includes('холодильник') || query.includes('cooler') || query.includes('компрессор')) {
      variations.push('холодильники');
      variations.push('морозильники');
      variations.push('8418');
    }

    // Knife sets - prioritize 8211 (knife sets) over 8215 (tableware)
    if (query.includes('нож') || query.includes('knife') || query.includes('набор ножей')) {
      variations.push('наборы ножей');
      variations.push('столовые ножи');
      variations.push('8211');
    }

    // 6. Try singular form (remove trailing 'и', 'ы', 'а')
    if (originalQuery.endsWith('и') || originalQuery.endsWith('ы') || originalQuery.endsWith('а')) {
      variations.push(originalQuery.slice(0, -1));
    }

    // 7. Try first 5 characters
    if (originalQuery.length > 5) {
      variations.push(originalQuery.substring(0, 5));
    }

    return variations;
  }

  var searchVariations = generateSearchVariations(goodsName);
  console.log('📋 Generated ' + searchVariations.length + ' search variations:', searchVariations);

  // While loop to iterate through search phrase variations until results found
  while (attempt < maxAttempts && results.length === 0) {
    if (attempt >= searchVariations.length) {
      console.log('⚠️ Exhausted all search variations without results');
      break;
    }

    var currentQuery = searchVariations[attempt];
    console.log('📡 Search attempt ' + (attempt + 1) + '/' + maxAttempts + ': "' + currentQuery + '"');

    try {
      var response = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        body: JSON.stringify({ query: currentQuery, size: 10 })
      }, 15000); // 15 second timeout

      if (response.ok) {
        var data = await response.json();
        var extracted = [];

        // Intelligent parsing of API responses
        if (data.content && Array.isArray(data.content)) {
          var isClothingQuery = query.toLowerCase().includes('футбол') || query.toLowerCase().includes('трикот') || query.toLowerCase().includes('рубаш');
          var isSmartWatch = query.toLowerCase().includes('час') || query.toLowerCase().includes('watch') || query.toLowerCase().includes('смарт');
          var isSolarPanel = query.toLowerCase().includes('солнеч') || query.toLowerCase().includes('solar');
          var isEVA = query.toLowerCase().includes('eva') || query.toLowerCase().includes('коврик');
          var isSupplement = query.toLowerCase().includes('бад') || query.toLowerCase().includes('биологически активная добавка') || query.toLowerCase().includes('витамин');
          var isLEDLight = query.toLowerCase().includes('led') || query.toLowerCase().includes('светильник') || query.toLowerCase().includes('растени');
          var isCooler = query.toLowerCase().includes('холодильник') || query.toLowerCase().includes('cooler');
          var isKnifeSet = query.toLowerCase().includes('нож') && query.toLowerCase().includes('набор');

          data.content.forEach(function(item) {
            var code = item.code || item.tnved || item.tnvedCode || item.kod;
            var description = item.description || item.title || item.name;

            if (code && code.match(/^\d{10}$/) && description) {
              var codeGroup = parseInt(code.substring(0, 2));
              var codeSubGroup = code.substring(0, 4);
              var priority = 1;

              // Smart watches: prioritize 9102 (electronic watches) over 8517 (communication devices)
              if (isSmartWatch) {
                if (code.startsWith('9102')) {
                  priority = 3; // Highest priority for electronic watches
                } else if (code.startsWith('8517')) {
                  priority = 1; // Lower priority for communication devices
                } else if (code.startsWith('9018')) {
                  priority = 2; // Medium priority for medical devices
                } else {
                  priority = 1;
                }
              }
              // Solar panels: prioritize 8541 (photoelectric modules)
              else if (isSolarPanel) {
                if (code.startsWith('854143')) {
                  priority = 3; // Highest priority for photoelectric modules
                } else if (code.startsWith('8541')) {
                  priority = 2; // Medium priority for general photoelectric devices
                } else if (code.startsWith('8504')) {
                  priority = 1; // Lower priority for converters
                } else {
                  priority = 1;
                }
              }
              // EVA materials: prioritize 3926 (plastic products)
              else if (isEVA) {
                if (code.startsWith('3926')) {
                  priority = 3; // Highest priority for plastic products
                } else if (code.startsWith('6306')) {
                  priority = 1; // Skip textile floor coverings
                  return;
                } else {
                  priority = 1;
                }
              }
              // Dietary supplements: prioritize 2106 (food supplements) over 3004 (medicines)
              else if (isSupplement) {
                if (code.startsWith('2106')) {
                  priority = 3; // Highest priority for food supplements
                } else if (code.startsWith('3004')) {
                  priority = 1; // Lower priority for medicines (requires registration)
                } else {
                  priority = 1;
                }
              }
              // LED grow lights: prioritize 9405 (luminaires) over 8539 (lamps)
              else if (isLEDLight) {
                if (code.startsWith('9405')) {
                  priority = 3; // Highest priority for luminaires
                } else if (code.startsWith('8539')) {
                  priority = 1; // Lower priority for lamps
                } else {
                  priority = 1;
                }
              }
              // Coolers with compressor: prioritize 8418 (refrigerators)
              else if (isCooler) {
                if (code.startsWith('841829')) {
                  priority = 3; // Highest priority for other refrigerators
                } else if (code.startsWith('8418')) {
                  priority = 2; // Medium priority for general refrigerators
                } else if (code.startsWith('8414')) {
                  priority = 1; // Lower priority for compressors only
                } else {
                  priority = 1;
                }
              }
              // Knife sets: prioritize 8211 (knife sets) over 8215 (tableware)
              else if (isKnifeSet) {
                if (code.startsWith('821110')) {
                  priority = 3; // Highest priority for knife sets
                } else if (code.startsWith('8211')) {
                  priority = 2; // Medium priority for general knives
                } else if (code.startsWith('8215')) {
                  priority = 1; // Lower priority for tableware
                } else {
                  priority = 1;
                }
              }
              // For 3D printers/additive manufacturing, prioritize group 8485
              else if (technicalDescription.toLowerCase().includes('3d') || technicalDescription.toLowerCase().includes('аддитив')) {
                if (codeGroup === 84 || codeGroup === 85) {
                  priority = 2;
                } else {
                  priority = 1;
                }
              }
              // For clothing, prioritize textile codes (groups 61-62)
              else if (isClothingQuery) {
                if (codeGroup === 48) {
                  return; // Skip paper/cellulose clothing
                }
                if (codeGroup >= 61 && codeGroup <= 62) {
                  priority = 2;
                } else {
                  priority = 1;
                }
              }
              // For dryers, prioritize group 8419
              else if (technicalDescription.toLowerCase().includes('сушил') || technicalDescription.toLowerCase().includes('dryer')) {
                if (codeGroup === 84 && code.substring(2, 4) === '19') {
                  priority = 2;
                } else {
                  priority = 1;
                }
              }
              // For vacuum cleaners, prioritize 8508 11 for robot vacuum cleaners with built-in motor
              else if (technicalDescription.toLowerCase().includes('пылесос') || technicalDescription.toLowerCase().includes('vacuum') || technicalDescription.toLowerCase().includes('robot')) {
                if (code.startsWith('850811')) {
                  priority = 3;
                } else if (code.startsWith('8508')) {
                  priority = 2;
                } else {
                  priority = 1;
                }
              }
              else {
                priority = 1;
              }

              extracted.push({ code: code, description: description, priority: priority });
            }
          });

          // Sort by priority (higher priority first)
          extracted.sort(function(a, b) { return b.priority - a.priority; });
        }

        if (extracted.length > 0) {
          console.log('✅ Found ' + extracted.length + ' results for "' + currentQuery + '"');
          extracted.forEach(function(item, index) {
            console.log('  ' + (index + 1) + '. ' + item.code + ' — ' + item.description.slice(0, 80));
          });
          results = extracted;
        } else {
          console.log('⚠️ No results for "' + currentQuery + '"');
        }
      } else {
        console.log('❌ API returned status:', response.status);
      }
    } catch(e) {
      console.log('⚠️ Error searching for "' + currentQuery + '":', e.message);
    }

    attempt++;
  }

  // Proper error handling after 5 failed attempts - try tnved.info with synonym variations
  if (results.length === 0) {
    console.log('⚠️ TN VED code not found in keden.kz after ' + maxAttempts + ' attempts');
    console.log('🔍 Trying tnved.info with synonym variations...');
    
    try {
      var tnvedInfoFetcher = require('./tnved_info_fetcher.js');
      var variations = tnvedInfoFetcher.generateSearchVariations(goodsName);
      
      for (var v = 0; v < variations.length; v++) {
        console.log('🔍 [tnved.info] Trying variation ' + (v + 1) + '/' + variations.length + ': ' + variations[v]);
        var tnvedResults = await tnvedInfoFetcher.searchTnvedInfo(variations[v]);
        
        if (tnvedResults.length > 0) {
          console.log('✅ [tnved.info] Found ' + tnvedResults.length + ' codes with variation: ' + variations[v]);
          return tnvedResults.map(function(item) {
            return {
              code: item.code,
              description: item.description,
              source: 'tnved.info',
              status: 'official'
            };
          });
        }
      }
    } catch(tnvedError) {
      console.error('❌ [tnved.info] Search failed:', tnvedError.message);
    }
    
    // If still no results, return not_found status (no AI generation)
    console.log('⚠️ TN VED code not found in any official database (keden.kz, tnved.info)');
    console.log('⚠️ Code requires manual verification - AI generation disabled as requested');
    return [{
      code: '0000000000',
      description: 'Код не найден в официальных базах - требует ручного ввода',
      source: 'Not Found',
      status: 'manual_required'
    }];
  }

  // Force selection of 8508110000 for robot vacuum cleaners with built-in motor/accumulator
  if (technicalDescription.toLowerCase().includes('пылесос') || technicalDescription.toLowerCase().includes('vacuum') || technicalDescription.toLowerCase().includes('robot')) {
    var found850811 = results.find(function(item) { return item.code.startsWith('850811'); });
    if (found850811) {
      console.log('✅ Forcing selection of 8508110000 for robot vacuum cleaner with built-in motor');
      return [found850811];
    }
  }

  // Force selection of 9102 for smart watches (prioritize electronic watches over communication devices)
  if (technicalDescription.toLowerCase().includes('час') || technicalDescription.toLowerCase().includes('watch') || technicalDescription.toLowerCase().includes('смарт')) {
    var found9102 = results.find(function(item) { return item.code.startsWith('9102'); });
    if (found9102) {
      console.log('✅ Forcing selection of 9102 for smart watches (electronic watches)');
      return [found9102];
    }
  }

  // Force selection of 854143 for solar panels (photoelectric modules)
  if (technicalDescription.toLowerCase().includes('солнеч') || technicalDescription.toLowerCase().includes('solar') || technicalDescription.toLowerCase().includes('панель')) {
    var found854143 = results.find(function(item) { return item.code.startsWith('854143'); });
    if (found854143) {
      console.log('✅ Forcing selection of 854143 for solar panels (photoelectric modules)');
      return [found854143];
    }
    var found8541 = results.find(function(item) { return item.code.startsWith('8541'); });
    if (found8541) {
      console.log('✅ Forcing selection of 8541 for solar panels');
      return [found8541];
    }
  }

  // Force selection of 3926 for EVA materials (plastic products)
  if (technicalDescription.toLowerCase().includes('eva') || technicalDescription.toLowerCase().includes('коврик')) {
    var found3926 = results.find(function(item) { return item.code.startsWith('3926'); });
    if (found3926) {
      console.log('✅ Forcing selection of 3926 for EVA materials (plastic products)');
      return [found3926];
    }
  }

  // Force selection of 2106 for dietary supplements (food supplements)
  if (technicalDescription.toLowerCase().includes('бад') || technicalDescription.toLowerCase().includes('биологически активная добавка') || technicalDescription.toLowerCase().includes('витамин')) {
    var found2106 = results.find(function(item) { return item.code.startsWith('2106'); });
    if (found2106) {
      console.log('✅ Forcing selection of 2106 for dietary supplements (food supplements)');
      return [found2106];
    }
  }

  // Force selection of 9405 for LED grow lights (luminaires)
  if (technicalDescription.toLowerCase().includes('led') || technicalDescription.toLowerCase().includes('светильник') || technicalDescription.toLowerCase().includes('растени')) {
    var found9405 = results.find(function(item) { return item.code.startsWith('9405'); });
    if (found9405) {
      console.log('✅ Forcing selection of 9405 for LED grow lights (luminaires)');
      return [found9405];
    }
  }

  // Force selection of 841829 for coolers with compressor (other refrigerators)
  if (technicalDescription.toLowerCase().includes('холодильник') || technicalDescription.toLowerCase().includes('cooler') || technicalDescription.toLowerCase().includes('компрессор')) {
    var found841829 = results.find(function(item) { return item.code.startsWith('841829'); });
    if (found841829) {
      console.log('✅ Forcing selection of 841829 for coolers with compressor');
      return [found841829];
    }
    var found8418 = results.find(function(item) { return item.code.startsWith('8418'); });
    if (found8418) {
      console.log('✅ Forcing selection of 8418 for coolers (refrigerators)');
      return [found8418];
    }
  }

  // Force selection of 821110 for knife sets
  if (technicalDescription.toLowerCase().includes('нож') && technicalDescription.toLowerCase().includes('набор')) {
    var found821110 = results.find(function(item) { return item.code.startsWith('821110'); });
    if (found821110) {
      console.log('✅ Forcing selection of 821110 for knife sets');
      return [found821110];
    }
    var found8211 = results.find(function(item) { return item.code.startsWith('8211'); });
    if (found8211) {
      console.log('✅ Forcing selection of 8211 for knives');
      return [found8211];
    }
  }

  // Force selection of 8528 52 100 0 for computer monitors (LCD)
  if (technicalDescription.toLowerCase().includes('монитор') || technicalDescription.toLowerCase().includes('monitor') || technicalDescription.toLowerCase().includes('lcd') || technicalDescription.toLowerCase().includes('display')) {
    console.log('✅ Forcing selection of 8528 52 100 0 for computer monitors');
    return [{ code: '8528 52 100 0', description: 'Мониторы компьютерные LCD' }];
  }

  // Apply AI selection if multiple results remain
  if (results.length > 1) {
    var characteristics = extractCharacteristics(technicalDescription);
    var bestMatch = await selectBestTNVEDCode(results, technicalDescription, characteristics);
    if (bestMatch) {
      console.log('✅ [Keden Search] AI selected: ' + bestMatch.code + ' - ' + bestMatch.description);
      return [bestMatch];
    }
  }

  return results.slice(0, 10);
}

// Enrich goods with TN VED codes from keden.kz
async function enrichGoodsWithOfficialTnved(goods) {
  if (!goods || goods.length === 0) return;

  for (var i = 0; i < goods.length; i++) {
    var good = goods[i];
    if (!good.tnved_code) {
      // Filter empty product names
      if (!good.name || good.name.trim().length < 3 || 
          good.name.trim().toLowerCase() === 'товар') {
        console.log('⚠️ [Filter] Empty or invalid product name: ' + good.name);
        good.tnved_status = 'api_failed';
        good.tnved_reason = '⚠️ Название товара не указано или некорректно. Пожалуйста, укажите наименование товара.';
        continue;
      }
      // Check local dictionary first (fastest)
      console.log('🔍 [Pipeline] Checking local dictionary for: ' + good.name);
      var lowerName = good.name ? good.name.toLowerCase() : '';
      var foundInDict = false;
      
      // Try exact match first
      for (var key in CONST_TNVED) {
        if (lowerName.includes(key)) {
          console.log('✅ [Pipeline] Source: Local - Found TN VED code ' + CONST_TNVED[key] + ' for: ' + good.name);
          good.tnved_code = CONST_TNVED[key];
          good.tnved_description = 'Код из локального словаря (официальный)';
          good.tnved_status = 'success';
          good.tnved_source = 'Local (официальный)';
          foundInDict = true;
          break;
        }
      }
      
      // If not found, try partial word matching
      if (!foundInDict) {
        for (var key in CONST_TNVED) {
          var keyParts = key.split(' ');
          var matchedParts = 0;
          for (var i = 0; i < keyParts.length; i++) {
            if (lowerName.includes(keyParts[i])) {
              matchedParts++;
            }
          }
          // If 50% or more of keyword parts match, use it
          if (matchedParts >= Math.ceil(keyParts.length / 2)) {
            console.log('✅ [Pipeline] Source: Local (partial match) - Found TN VED code ' + CONST_TNVED[key] + ' for: ' + good.name);
            good.tnved_code = CONST_TNVED[key];
            good.tnved_description = 'Код из локального словаря (официальный)';
            good.tnved_status = 'success';
            good.tnved_source = 'Local (partial, официальный)';
            foundInDict = true;
            break;
          }
        }
      }
      
      // Component breakdown search with lemmatization
      if (!foundInDict) {
        var coreName = extractCoreProductName(good.name);
        console.log('🔍 [Component Breakdown] Core name extracted: ' + coreName);
        
        for (var key in CONST_TNVED) {
          if (coreName.includes(key) || key.includes(coreName)) {
            console.log('✅ [Pipeline] Source: Local (component breakdown) - Found TN VED code ' + CONST_TNVED[key] + ' for: ' + good.name);
            good.tnved_code = CONST_TNVED[key];
            good.tnved_description = 'Код из локального словаря (официальный)';
            good.tnved_status = 'success';
            good.tnved_source = 'Local (component breakdown, официальный)';
            foundInDict = true;
            break;
          }
        }
      }
      
      if (foundInDict) continue;
      
      console.log('🔍 [Pipeline] Not found in dictionary, trying elastic search');

      // Elastic Search: Extract noun and try prefix search
      var noun = extractNounFromName(good.name);
      if (noun) {
        console.log('🔍 [Elastic Search] Extracted noun: ' + noun);
        
        // Try prefix search based on noun
        var prefixMap = {
          'панель': '8541',
          'panel': '8541',
          'модуль': '8541',
          'module': '8541',
          'инвертор': '8504',
          'inverter': '8504'
        };
        
        if (prefixMap[noun]) {
          var prefix = prefixMap[noun];
          console.log('🔍 [Elastic Search] Using prefix ' + prefix + ' for noun ' + noun);
          var technicalDesc = await convertToTechnicalDescription(good.name);
          var deepSearchResult = await deepSearchForSpecificCode(prefix, technicalDesc);
          if (deepSearchResult && deepSearchResult.code) {
            console.log('✅ [Elastic Search] Found code: ' + deepSearchResult.code);
            good.tnved_code = deepSearchResult.code;
            good.tnved_description = deepSearchResult.description + ' (официальный справочник KGD)';
            good.tnved_status = 'success';
            good.tnved_source = 'Elastic Search (официальный KGD)';
            continue;
          }
        }
      }

      // Run AI pre-analysis + keden.kz search (now includes AI pre-analysis and deep validation)
      try {
        var result = await searchKeden(good.name);
        if (result && result.length > 0 && result[0].code) {
          var code = result[0].code;
          
          // KGD Verification: Verify code exists in KGD database (NON-BLOCKING)
          var kgdVerified = await verifyCodeInKGD(code);
          if (!kgdVerified) {
            console.log('⚠️ [Pipeline] Code ' + code + ' not verified in KGD database, but found in official keden.kz search');
            console.log('⚠️ [Pipeline] Using code from official database despite verification failure (API endpoint issues)');
            console.log('⚠️ [Pipeline] This is acceptable since code was found in official keden.kz database');
            good.tnved_warning = 'Код найден в официальной базе keden.kz (верификация в КГД временно недоступна из-за проблем с API). Рекомендуется проверить точность кода.';
            good.tnved_status = 'official_unverified';
            // Continue with the found code instead of blocking
          }
          
          // Check if code is generic (ends with 5+ zeros) and try vertical search
          if (code.endsWith('00000')) {
            console.log('⚠️ [Pipeline] Generic code detected (' + code + '), attempting vertical search...');
            var technicalDesc = await convertToTechnicalDescription(good.name);
            var prefix = code.substring(0, 4); // Use first 4 digits as prefix
            var verticalResult = await verticalSearch(prefix, technicalDesc);
            
            if (verticalResult && verticalResult.code) {
              console.log('✅ [Pipeline] Source: Vertical Search - Found specific TN VED code ' + verticalResult.code + ' for: ' + good.name);
              good.tnved_code = verticalResult.code;
              good.tnved_description = verticalResult.description + ' (официальный справочник KGD)';
              good.tnved_status = 'success';
              good.tnved_source = 'Vertical Search (официальный)';
              continue;
            } else {
              console.log('⚠️ [Pipeline] Vertical search failed, using generic code as fallback');
            }
          }
          
          console.log('✅ [Pipeline] Source: ' + (result[0].source || 'Keden') + ' - Found TN VED code ' + code + ' for: ' + good.name);
          good.tnved_code = code;
          good.tnved_description = result[0].description + ' (официальный справочник KGD)';
          good.tnved_status = result[0].status || 'success';
          good.tnved_source = (result[0].source || 'Keden') + ' (официальный)';
        } else {
          // No results from keden.kz - do NOT use AI to generate codes
          console.log('⚠️ [Pipeline] keden.kz returned no results - AI will NOT generate codes (strict rule)');
          good.tnved_status = 'api_failed';
          good.tnved_reason = 'Поиск по базам Keden и TNVED не дал 100% результата. Пожалуйста, выберите один из найденных вариантов или введите код вручную.';
        }
      } catch(e) {
        console.error('❌ [Pipeline] Ошибка поиска ТН ВЭД:', e.message);
        good.tnved_status = 'api_failed';
        good.tnved_reason = 'Поиск по базам Keden и TNVED не дал 100% результата. Пожалуйста, выберите один из найденных вариантов или введите код вручную.';
      }
    }
  }
}

// Export functions
module.exports = {
  setKeyword,
  generateDeclarationMessage,
  processFormData,
  getExchangeRate,
  calculateCustomsPayments,
  generatePDF,
  handleAskCommand,
  analyzeMissingData,
  enrichGoodsWithOfficialTnved,
  searchKeden,
  validateData,
  validateTNVEDCode,
  convertToTechnicalDescription,
  selectBestTNVEDCode,
  extractCharacteristics,
  validateCodeExistsInKGD,
  verticalSearch,
  determinePhysicalEssence,
  validateCrossCategory,
  extractTechSpecs,
  deepSearchForSpecificCode,
  verifyCodeInKGD,
  selectCodeByTechSpecs,
  extractNounFromName,
  validateTransportDocument,
  validatePackaging,
  lemmatizeRussian,
  extractCoreProductName,
  handleUnsureCodes,
  classifyFromKGDResults
};
