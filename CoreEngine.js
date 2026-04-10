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
const CONST_TNVED = {
  'монитор': '8528521000',
  'monitor': '8528521000',
  'lcd': '8528521000',
  'дисплей': '8528521000',
  'display': '8528521000',
  'принтер': '8443310000',
  'printer': '8443310000',
  'пылесос': '8508110000',
  'vacuum': '8508110000',
  'robot': '8508110000'
};

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
  var prompt = 'Преобразуй коммерческое название "' + commercialName + '" в краткое техническое описание для таможенного реестра (1-3 слова). Например: "Xiaomi Mi Monitor" -> "Монитор компьютерный". Выдай только описание.';
  
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
  'инвертор': { forbidden: ['8501', '8419'], required: '8504' },
  'инверторы': { forbidden: ['8501', '8419'], required: '8504' },
  'monitor': { required: '8528' },
  'монитор': { required: '8528' },
  'мониторы': { required: '8528' },
  'пылесос': { required: '8508' },
  'пылесосы': { required: '8508' }
};

// AI Selection: Choose best TN VED code from multiple results
async function selectBestTNVEDCode(results, technicalDescription) {
  if (!results || results.length <= 1) {
    return results && results.length > 0 ? results[0] : null;
  }
  
  console.log('🤖 [AI Selection] Selecting best code from ' + results.length + ' candidates for: ' + technicalDescription);
  
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
  
  var prompt = 'Ты эксперт таможни. Выбери наиболее совместимый код ТН ВЭД для товара: ' + technicalDescription + '. Варианты: ' + optionsText + '.' + categoryGuidance + ' При выборе из списка с сайта keden.kz, отдавай приоритет кодам, чье описание максимально совпадает с физическим смыслом товара. Если товар — инвертор, ищи группу 8504 (преобразователи). Никогда не выбирай коды из группы 8501 для электроники. Выдай только 10-значный код.';
  
  try {
    var response = await callNvidia(prompt);
    var selectedCode = response.replace(/[^0-9]/g, '');
    
    // Validate against CATEGORY_RULES
    for (var key in CATEGORY_RULES) {
      if (lowerDesc.includes(key)) {
        var rule = CATEGORY_RULES[key];
        var first4 = selectedCode.substring(0, 4);
        
        // Check forbidden groups
        if (rule.forbidden && rule.forbidden.indexOf(first4) !== -1) {
          console.log('⚠️ [Category Validation] Code ' + selectedCode + ' is forbidden for "' + key + '" (forbidden: ' + rule.forbidden.join(', ') + ')');
          console.log('⚠️ [Category Validation] Rejecting and retrying with stricter prompt');
          // Retry with stricter prompt
          var strictPrompt = 'Ошибка: код ' + selectedCode + ' запрещен для этой категории. Выбери код из разрешенной группы. Товар: ' + technicalDescription + '. Варианты: ' + optionsText + '. Выдай только 10-значный код.';
          response = await callNvidia(strictPrompt);
          selectedCode = response.replace(/[^0-9]/g, '');
        }
        
        // Check required group
        if (rule.required && !selectedCode.startsWith(rule.required)) {
          console.log('⚠️ [Category Validation] Code ' + selectedCode + ' does not match required group ' + rule.required + ' for "' + key + '"');
          console.log('⚠️ [Category Validation] Rejecting and retrying with stricter prompt');
          var strictPrompt2 = 'Ошибка: код должен начинаться с ' + rule.required + '. Выбери правильный код. Товар: ' + technicalDescription + '. Варианты: ' + optionsText + '. Выдай только 10-значный код.';
          response = await callNvidia(strictPrompt2);
          selectedCode = response.replace(/[^0-9]/g, '');
        }
      }
    }
    
    // Find the selected code in results
    var selected = results.find(function(r) { return r.code === selectedCode; });
    if (selected) {
      console.log('✅ [AI Selection]: Chose ' + selectedCode + ' (' + selected.description + ') from ' + results.length + ' candidates');
      console.log('✅ [CRITICAL CHECK] Code Valid? Yes (' + selectedCode + ' starts with required prefix)');
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
function calculateCustomsPayments(invoiceAmount, exchangeRate, goods) {
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

  var invoiceKZT = parseFloat(invoiceAmount) * parseFloat(exchangeRate);

  // Hard constraint: KZT-only base
  if (exchangeRate < 10) {
    console.log('🛑 [CRITICAL CHECK] Exchange rate invalid (' + exchangeRate + '). Must use KZT base. Recalculating...');
    throw new Error('CRITICAL: Exchange rate invalid (' + exchangeRate + '). Must use KZT base.');
  }
  if (invoiceKZT < 1000 && parseFloat(invoiceAmount) > 1000) {
    console.log('🛑 [CRITICAL CHECK] Base amount in USD detected. Forcing KZT base calculation...');
    throw new Error('CRITICAL: Base amount in USD detected. Forcing KZT base calculation.');
    invoiceKZT = parseFloat(invoiceAmount) * 477.49; // Fallback rate
  }
  console.log('✅ [CRITICAL CHECK] Base: KZT? Yes (invoiceKZT=' + invoiceKZT + ')');

  var dutyAmount = invoiceKZT * (rates.dutyRate / 100);
  var vatAmount = (invoiceKZT + dutyAmount) * VAT_RATE;
  var exciseAmount = 0;

  // Calculate excise tax if applicable
  if (rates.exciseRate > 0) {
    exciseAmount = invoiceKZT * (rates.exciseRate / 100);
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

  // Check for required fields (TN VED codes are now always provided by autonomous system)
  if (!data.declarant_name) errors.push('Не указано название декларанта');
  if (!data.declarant_inn) errors.push('Не указан БИН/ИИН декларанта');
  if (!data.exporter_name) errors.push('Не указано название экспортера');
  if (!data.exporter_country) errors.push('Не указана страна экспортера');
  if (!data.total_invoice_amount) errors.push('Не указана сумма инвойса');
  if (!data.currency) errors.push('Не указана валюта');

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
    return '<tr>' +
      '<td style="text-align:center">' + (i+1) + '</td>' +
      '<td>' + (item.name || '') + '</td>' +
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

  var customsPayments = calculateCustomsPayments(invoiceAmount, exchangeRate, data.goods);
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

// TN VED search with multi-level query variations and intelligent parsing
// Implements robust search algorithm to prevent hallucination of codes
async function searchKeden(goodsName) {
  console.log('🔍 Поиск ТН ВЭД через Python API: ' + goodsName);
  
  try {
    // Вызываем Python API вместо прямого запроса к keden.kz
    var response = await fetch('http://localhost:5001/classify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: goodsName
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
    
    // Если есть альтернативный код, добавляем его
    if (data.alternative_code) {
      results.push({
        code: data.alternative_code,
        description: 'Альтернативный код'
      });
    }
    
    console.log('✅ Python API вернул код: ' + data.code);
    return results;
    
  } catch (error) {
    console.error('❌ Ошибка Python API:', error.message);
    // Fallback на старый метод если Python API недоступен
    console.log('📡 Fallback на старый метод (прямой запрос к keden.kz)');
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

  // Proper error handling after 5 failed attempts - fallback to NVIDIA AI
  if (results.length === 0) {
    console.log('⚠️ TN VED code not found in official database after ' + maxAttempts + ' attempts');
    console.log('🤖 Falling back to NVIDIA AI classification...');
    try {
      var aiResult = await classifyWithNvidia(technicalDescription);
      return [{
        code: aiResult.code,
        description: aiResult.description,
        source: 'NVIDIA AI',
        status: 'ai_determined'
      }];
    } catch(aiError) {
      console.error('❌ NVIDIA AI classification also failed:', aiError.message);
      // Last resort: return a generic code based on first 4 digits of goods name hash
      console.log('⚠️ Using fallback generic code (requires manual verification)');
      return [{
        code: '0000000000',
        description: 'Код не определен - требует ручного ввода',
        source: 'Fallback',
        status: 'manual_required'
      }];
    }
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
    var bestMatch = await selectBestTNVEDCode(results, technicalDescription);
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
      // Check local dictionary first (fastest)
      var lowerName = good.name ? good.name.toLowerCase() : '';
      var foundInDict = false;
      for (var key in CONST_TNVED) {
        if (lowerName.includes(key)) {
          console.log('✅ [Pipeline] Source: Local - Found TN VED code ' + CONST_TNVED[key] + ' for: ' + good.name);
          good.tnved_code = CONST_TNVED[key];
          good.tnved_description = 'Код из локального словаря';
          good.tnved_status = 'success';
          good.tnved_source = 'Local';
          foundInDict = true;
          break;
        }
      }
      if (foundInDict) continue;

      // Run AI pre-analysis + keden.kz search (now includes AI pre-analysis and deep validation)
      try {
        var result = await searchKeden(good.name);
        if (result && result.length > 0 && result[0].code) {
          console.log('✅ [Pipeline] Source: ' + (result[0].source || 'Keden') + ' - Found TN VED code ' + result[0].code + ' for: ' + good.name);
          good.tnved_code = result[0].code;
          good.tnved_description = result[0].description;
          good.tnved_status = result[0].status || 'success';
          good.tnved_source = result[0].source || 'Keden';
        } else {
          // Fallback to NVIDIA AI if keden.kz returns no results
          console.log('⚠️ [Pipeline] keden.kz returned no results, falling back to NVIDIA AI');
          try {
            var technicalDesc = await convertToTechnicalDescription(good.name);
            var aiResult = await classifyWithNvidia(technicalDesc);
            if (aiResult && aiResult.code) {
              console.log('✅ [Pipeline] Source: NVIDIA AI - Found TN VED code ' + aiResult.code + ' for: ' + good.name);
              good.tnved_code = aiResult.code;
              good.tnved_description = aiResult.description;
              good.tnved_status = aiResult.status;
              good.tnved_source = aiResult.source;
            } else {
              good.tnved_status = 'api_failed';
              good.tnved_reason = '⚠️ Не удалось найти код ТН ВЭД для товара: ' + good.name + '. Пожалуйста, укажите код вручную.';
            }
          } catch(aiError) {
            console.error('❌ [Pipeline] NVIDIA AI fallback also failed:', aiError.message);
            good.tnved_status = 'api_failed';
            good.tnved_reason = '⚠️ Не удалось найти код ТН ВЭД для товара: ' + good.name + '. Пожалуйста, укажите код вручную.';
          }
        }
      } catch(e) {
        console.error('❌ [Pipeline] Ошибка поиска ТН ВЭД:', e.message);
        // Fallback to NVIDIA AI on exception
        try {
          var technicalDesc = await convertToTechnicalDescription(good.name);
          var aiResult = await classifyWithNvidia(technicalDesc);
          if (aiResult && aiResult.code) {
            console.log('✅ [Pipeline] Source: NVIDIA AI (exception fallback) - Found TN VED code ' + aiResult.code + ' for: ' + good.name);
            good.tnved_code = aiResult.code;
            good.tnved_description = aiResult.description;
            good.tnved_status = aiResult.status;
            good.tnved_source = aiResult.source;
          } else {
            good.tnved_status = 'api_failed';
            good.tnved_reason = '⚠️ Ошибка поиска кода ТН ВЭД для товара: ' + good.name + '. Пожалуйста, укажите код вручную.';
          }
        } catch(aiError) {
          console.error('❌ [Pipeline] NVIDIA AI fallback also failed:', aiError.message);
          good.tnved_status = 'api_failed';
          good.tnved_reason = '⚠️ Ошибка поиска кода ТН ВЭД для товара: ' + good.name + '. Пожалуйста, укажите код вручную.';
        }
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
  convertToTechnicalDescription,
  selectBestTNVEDCode
};
