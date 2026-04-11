// Enhanced Form Parser with "Field: Value" format support
// This module provides improved parsing for customs declaration data

const https = require('https');
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';

// Lightweight NVIDIA API call for semantic validation
function isLikelyProductName(text) {
  return new Promise(function(resolve, reject) {
    var prompt = 'Является ли строка "' + text + '" названием физического товара? Ответь только YES или NO.';
    var body = JSON.stringify({
      model: 'meta/llama-3.3-70b-instruct',
      max_tokens: 50,
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
          var response = result.choices[0].message.content.trim().toUpperCase();
          console.log('🤖 LLM validation: "' + text + '" → ' + response);
          resolve(response === 'YES');
        } catch(e) {
          console.error('❌ LLM validation error:', e.message);
          resolve(false);
        }
      });
    });

    req.on('error', function(e) {
      console.error('❌ LLM request error:', e.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

// Clean goods name by stripping packaging prefixes
function cleanGoodsName(text) {
  if (!text) return text;
  
  var original = text;
  // Strip patterns like "12 коробок на 1 паллете", "15 шт", "20 кг", etc.
  var cleaned = text.replace(/^\d+\s*(коробок|паллет|мест|ящиков|упаковок|поддонов|шт|кг)\s*(на\s+\d+\s*(паллет|ящиков|мест))?\s*/gi, '');
  cleaned = cleaned.replace(/^\d+\s*(коробок|паллет|мест|ящиков|упаковок|поддонов|шт|кг)\s+/gi, '');
  
  if (cleaned !== original) {
    console.log('🧹 Cleaned goods name: "' + original + '" → "' + cleaned + '"');
  }
  
  return cleaned.trim();
}

// Semantic check for goods name validation
function isValidGoodsName(value, data) {
  if (!value) return false;
  
  // Check if numeric
  if (/^[\d.]+$/.test(value)) {
    console.log('⚠️ Value is numeric, not a valid goods name: ' + value);
    return false;
  }
  
  // Check if too short
  if (value.length < 3) {
    console.log('⚠️ Value too short, not a valid goods name: ' + value);
    return false;
  }
  
  // Cross-check with weights
  if (data.gross_weight && value === data.gross_weight) {
    console.log('⚠️ Value matches gross_weight, skipping: ' + value);
    return false;
  }
  if (data.net_weight && value === data.net_weight) {
    console.log('⚠️ Value matches net_weight, skipping: ' + value);
    return false;
  }
  
  return true;
}

function parseEnhancedFormData(text) {
  console.log('Enhanced parsing started...');
  
  var data = {
    declarant_name: '',
    declarant_inn: '',
    declarant_address: '',
    exporter_name: '',
    exporter_country: '',
    exporter_address: '',
    currency: '',
    total_invoice_amount: '',
    invoice_number: '',
    invoice_date: '',
    contract_number: '',
    delivery_terms: '',
    border_crossing: '',
    transport_id: '',
    document_code: '',
    financial_doc: '',
    gross_weight: '',
    net_weight: '',
    packages_count: '',
    packaging_type: '',
    goods: []
  };
  
  // Split by newlines and clean up
  var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  
  console.log('Lines to parse:', lines.length);
  
  // Filter out form template field names (common Russian field names from the template)
  var fieldNames = [
    'название декларанта', 'бин/иин', 'адрес декларанта', 'название экспортера', 
    'страна', 'адрес экспортера', 'номер инвойса', 'дата инвойса', 'сумма инвойса', 
    'валюта', 'номер контракта', 'условия поставки', 'пункт пропуска границы', 
    'номер транспортного средства', 'финансовый документ', 'брутто вес', 'нетто вес', 
    'количество мест', 'наименование товара', 'количество товара', 'страна происхождения товара',
    'отправьте данные для декларации', 'обязательно заполняйте все поля по порядку',
    'если что-то не понятно', 'напишите команду /ask'
  ];
  
  lines = lines.filter(function(line) {
    var lowerLine = line.toLowerCase();
    // Filter out lines that match field names from the template
    for (var i = 0; i < fieldNames.length; i++) {
      if (lowerLine === fieldNames[i] || lowerLine.startsWith(fieldNames[i])) {
        return false;
      }
    }
    return true;
  });
  
  console.log('Lines after filtering template fields:', lines.length);

  // Check if lines are numbered (e.g., "1. value", "2. value")
  var numberedLines = lines.filter(function(line) {
    return /^\d+[.\)]+\s/.test(line);
  });

  // Skip natural language patterns if we have 15+ lines (likely positional format)
  // Also treat 21-line input as positional format (matches form template)
  // But only if NOT already numbered (numbered format should use numbered parser)
  // CRITICAL: This check must happen BEFORE natural language pattern matching
  if ((lines.length >= 15 || lines.length === 21) && numberedLines.length < 5) {
    console.log('📋 Detected long input (' + lines.length + ' lines), skipping natural language patterns, using positional parsing');
    return parseSimpleListFormat(text, data);
  }

  // Natural language patterns
  var naturalPatterns = {
    declarant_name: [
      /(?:name|company|declarant|organization|org|title|tittle|firma|firm|company name|declarant name|t?oo|llc|ltd|inc|corp)[\s:]*([^\n\r]+)/gi,
      /(?:(?:i am|we are|this is|it's|its|my|our)[\s]*)([^\n\r]+?)(?:\s|$)/gi,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s|$)/gi,
      // Russian patterns
      /(?:name|title|company|declarant|organization|org|title|tittle|firma|firm|company name|declarant name|t?oo|llc|ltd|inc|corp)[\s:]*([^\n\r]+)/gi,
      /(?:name|title|company|declarant|organization|org|title|tittle|firma|firm|company name|declarant name|t?oo|llc|ltd|inc|corp)[\s:]*([^\n\r]+)/gi,
      // Russian specific
      /(?:name|title|company|declarant|organization|org|title|tittle|firma|firm|company name|declarant name|t?oo|llc|ltd|inc|corp)[\s:]*([^\n\r]+)/gi,
      /(?:name|title|company|declarant|organization|org|title|tittle|firma|firm|company name|declarant name|t?oo|llc|ltd|inc|corp)[\s:]*([^\n\r]+)/gi
    ],
    declarant_inn: [
      /(?:bin|inn|iin|tax\s*id|tax\s*number|identification|registration|reg\s*number)[\s:]*([0-9]{12})/gi,
      /\b([0-9]{12})\b/gi,
      // Russian
      /(?:bin|inn|iin|tax\s*id|tax\s*number|identification|registration|reg\s*number)[\s:]*([0-9]{12})/gi
    ],
    exporter_name: [
      /(?:supplier|vendor|exporter|seller|manufacturer|producer|from|by)[\s:]*([^\n\r,]+)/gi,
      /(?:from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}))/gi,
      // Russian
      /(?:supplier|vendor|exporter|seller|manufacturer|producer|from|by)[\s:]*([^\n\r,]+)/gi,
      // Pattern for company names with Inc/Ltd/LLC
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|LTD|LLC|Corp|Co))/gi
    ],
    exporter_country: [
      /(?:from|country|origin|made in|shipped from)[\s:]*([A-Z]{2,3})/gi,
      /(?:country|origin)[\s:]*([^\n\r,]+)/gi,
      // Russian
      /(?:страна|из|откуда|отправление)[\s:]*([^\n\r,]+)/gi,
      // Country codes - exactly 2-3 uppercase letters
      /\b(CN|US|TR|AE|DE|GB|IT|FR|ES|PL|KR|JP|IN|BR|AR|MX|CA|AU|KZ|RU|UA|BY|KG|UZ|TJ|TM)\b/gi
    ],
    currency: [
      /\b(USD|EUR|CNY|KZT|RUB|GBP|JPY|TRY|AED|SAR|THB|INR|BRL|MXN|CAD|AUD)\b/gi,
      /(?:валюта|курс|деньги|платеж|usd|eur|kzt|rub|cny|gbp|jpy|try|aed|sar|thb|inr|brl|mxn|cad|aud)/gi,
      /(?:\$|usd|доллар|доллары|евро|тенге|рубли|юань|фунт|лира|дирхам|риал|бат|рупия|реал|песо|луни|австралийский)/gi
    ],
    total_invoice_amount: [
      /(?:amount|total|sum|price|cost|value|invoice|payment|charge|fee)\s*[:\s]*(?=\d)[0-9,.]+/gi,
      /(?:\$|usd|eur|kzt|rub|cny|gbp|jpy|try|aed|sar|thb|inr|brl|mxn|cad|aud)?\s*(?=\d)[0-9,.]+\s*(?:usd|eur|kzt|rub|cny|gbp|jpy|try|aed|sar|thb|inr|brl|mxn|cad|aud|dollar|euro|tenge|ruble|yuan|pound|lira|dirham|rial|baht|rupee|real|peso|loonie|australian)?/gi,
      // Russian
      /(?:сумма|итого|цена|стоимость|оплата|платеж)\s*[:\s]*(?=\d)[0-9,.]+/gi,
      // Standalone numbers that look like amounts (not 12-digit IINs, not single digits)
      /\b([0-9]{2,7}(?:[.,][0-9]{1,2})?)\b/gi
    ],
    invoice_number: [
      /(?:invoice|inv|invoice\s*#|invoice\s*no|number|num|ref|reference|id)\s*[:\s]*([^\n\r,]+)/gi,
      /(?:invoice\s*(?:number|#|no)?\s*[:\s]*)([^\n\r,]+)/gi,
      // Russian
      /(?:invoice|inv|invoice\s*#|invoice\s*no|number|num|ref|reference|id|invoice|inv|invoice\s*#|invoice\s*no|number|num|ref|reference|id)\s*[:\s]*([^\n\r,]+)/gi
    ],
    contract_number: [
      /(?:contract|ctr|contract\s*#|contract\s*no|agreement|deal)\s*[:\s]*([^\n\r,]+)/gi,
      /(?:contract\s*(?:number|#|no)?\s*[:\s]*)([^\n\r,]+)/gi,
      // Russian
      /(?:contract|ctr|contract\s*#|contract\s*no|agreement|deal|contract|ctr|contract\s*#|contract\s*no|agreement|deal)\s*[:\s]*([^\n\r,]+)/gi
    ],
    gross_weight: [
      /(?:weight|gross|kg|kilogram|kilos|tons|tonne|mass)\s*[:\s]*([0-9,.]+)\s*(?:kg|kgs|kilogram|kilos|ton|tons|tonne)?/gi,
      /([0-9,.]+)\s*(?:kg|kgs|kilogram|kilos|ton|tons|tonne)/gi,
      // Russian
      /(?:weight|gross|kg|kilogram|kilos|tons|tonne|mass|weight|gross|kg|kilogram|kilos|tons|tonne|mass|weight|gross|kg|kilogram|kilos|tons|tonne|mass)\s*[:\s]*([0-9,.]+)\s*(?:kg|kgs|kilogram|kilos|ton|tons|tonne)?/gi
    ],
    goods_name: [
      /(?:product|item|goods|commodity|material|cargo|shipment|what|which)\s*[:\s]*([^\n\r,]+)/gi,
      /(?:we\s*need|i\s*need|order|request|want)\s*[:\s]*([^\n\r,]+)/gi,
      // Russian
      /(?:product|item|goods|commodity|material|cargo|shipment|what|which|product|item|goods|commodity|material|cargo|shipment|what|which)\s*[:\s]*([^\n\r,]+)/gi,
      // Pattern for product names (Russian words)
      /([A-Za-z]+(?:\s+[A-Za-z]+)*\s+[A-Za-z]+)/gi,
      // Pattern for Russian product names
      /([A-Za-z]+(?:\s+[A-Za-z]+)*)/gi
    ],
    goods_quantity: [
      /(?:quantity|qty|amount|count|number|how\s*many|units|pcs|pieces|items)\s*[:\s]*([0-9,.]+)/gi,
      /([0-9,.]+)\s*(?:pcs|pieces|units|items|pcs|pc|ea|each)/gi,
      // Russian
      /(?:quantity|qty|amount|count|number|how\s*many|units|pcs|pieces|items|quantity|qty|amount|count|number|how\s*many|units|pcs|pieces|items)\s*[:\s]*([0-9,.]+)/gi,
      // Pattern for quantities with Russian "pcs"
      /([0-9,.]+)\s*(?:pcs|pieces|units|items|pcs|pc|ea|each|pcs|pieces|units|items|pcs|pc|ea|each)/gi,
      // Pattern for numbers followed by "pcs" or similar
      /([0-9]+)\s*(?:pcs|pieces|units|items|pc|ea|each|pcs|pieces|units|items|pc|ea|each)/gi
    ]
  };
  
  // Apply natural language patterns
  for (var field in naturalPatterns) {
    var patterns = naturalPatterns[field];
    for (var i = 0; i < patterns.length; i++) {
      var matches = text.match(patterns[i]);
      if (matches && matches.length > 1) {
        var value = matches[1] || matches[0];
        if (value && value.trim()) {
          data[field] = value.trim();
          value = value.trim();
          // Normalize country codes
          if (value.toLowerCase().includes('usa') || value.toLowerCase().includes('united states')) value = 'US';
          else if (value.toLowerCase().includes('china') || value.toLowerCase().includes('china')) value = 'CN';
          else if (value.toLowerCase().includes('kazakhstan') || value.toLowerCase().includes('kazakhstan')) value = 'KZ';
          else if (value.toLowerCase().includes('russia') || value.toLowerCase().includes('russia')) value = 'RU';
          else if (value.toLowerCase().includes('turkey') || value.toLowerCase().includes('turkey')) value = 'TR';
          else if (value.toLowerCase().includes('uae') || value.toLowerCase().includes('emirates')) value = 'AE';
        }
        
        if (value && value.length > 0) {
          data[field] = value;
          console.log('Found ' + field + ': ' + value);
          break;
        }
      }
    }
  }
  
  // Special logic for simple format recognition
  // Skip natural language pattern extraction if we have 15+ lines (likely positional format)
  // Note: This check is now done earlier in the function (before natural language patterns)
  if (lines.length < 15) {
    lines.forEach(function(line) {
      var trimmedLine = line.trim();

      // Check for Russian country names FIRST (highest priority)
      if (/^(китай|china|кнр|сша|usa|турция|turkey|оаэ|uae|германия|germany|индия|india|бразилия|brazil|казахстан|kazakhstan|россия|russia|украина|ukraine)$/i.test(trimmedLine) && !data.exporter_country) {
        var countryMap = {
          'китай': 'CN', 'china': 'CN', 'кнр': 'CN',
          'сша': 'US', 'usa': 'US',
          'турция': 'TR', 'turkey': 'TR',
          'оаэ': 'AE', 'uae': 'AE',
          'германия': 'DE', 'germany': 'DE',
          'индия': 'IN', 'india': 'IN',
          'бразилия': 'BR', 'brazil': 'BR',
          'казахстан': 'KZ', 'kazakhstan': 'KZ',
          'россия': 'RU', 'russia': 'RU',
          'украина': 'UA', 'ukraine': 'UA'
        };
        var countryKey = trimmedLine.toLowerCase();
        data.exporter_country = countryMap[countryKey] || trimmedLine.substring(0, 2).toUpperCase();
        console.log('Found country (Russian): ' + trimmedLine + ' -> ' + data.exporter_country);
        return;
      }

      // Check for BIN (12 digits)
      if (/^\d{12}$/.test(trimmedLine) && !data.declarant_inn) {
        data.declarant_inn = trimmedLine;
        console.log('Found BIN: ' + trimmedLine);
      }
      // Check for company names with Inc/Ltd/LLC
      else if (/\b(Inc|LTD|LLC|Corp|Co|Electronics|Technology)\b/i.test(trimmedLine) && !data.exporter_name) {
        data.exporter_name = trimmedLine;
        console.log('Found company: ' + trimmedLine);
      }
      // Check for country codes (2-3 letters)
      else if (/^[A-Z]{2,3}$/.test(trimmedLine) && !data.exporter_country) {
        data.exporter_country = trimmedLine.toUpperCase();
        console.log('Found country code: ' + trimmedLine);
      }
      // Check for country names (capitalized English) - but exclude company-like words
      else if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(trimmedLine) && trimmedLine.length > 3 && !data.exporter_country && !/\b(Electronics|Technology|Corp|Inc|Ltd|LLC)\b/i.test(trimmedLine)) {
        data.exporter_country = trimmedLine;
        console.log('Found country: ' + trimmedLine);
      }
      // Check for quantities with "pcs"
      else if (/\d+pcs/i.test(line) && !data.goods_quantity) {
        data.goods_quantity = line.trim();
        console.log('Found quantity: ' + line.trim());
      }
      // Check for invoice numbers (12+ digits)
      else if (/^\d{12,}$/.test(line.trim()) && !data.declarant_inn && !data.invoice_number) {
        data.invoice_number = line.trim();
        console.log('Found invoice number: ' + line.trim());
      }
      // Check for amounts (large numbers)
      else if (/^\d{7,}$/.test(line.trim()) && !data.declarant_inn && !data.invoice_number && !data.total_invoice_amount) {
        data.total_invoice_amount = line.trim();
        console.log('Found amount: ' + line.trim());
      }
      // Check for product names (contains letters)
      else if (/[A-Za-z]/.test(line) && line.length > 2 && !/^\d+$/.test(line) && !data.goods_name) {
        data.goods_name = line.trim();
        console.log('Found product: ' + line.trim());
      }
    });
  } else {
    console.log('📋 Detected long input (' + lines.length + ' lines), skipping natural language patterns, using positional parsing');
  }
  
  // Check for "Field: Value" format
  var hasFieldFormat = lines.some(function(line) { return /^[^:]+:\s*/.test(line); });

  // Check for numbered list format (1. value, 2. value, etc.) - must have sequential numbering
  var numberedLines = lines.filter(function(line) {
    var trimmed = line.trim();
    return /^\d+[.\)]+\s/.test(trimmed);
  });
  var hasNumberedFormat = numberedLines.length >= 2;

  // Verify sequential numbering
  if (hasNumberedFormat) {
    var sequentialCount = 0;
    for (var i = 0; i < numberedLines.length; i++) {
      var match = numberedLines[i].match(/^(\d+)[.\)]+\s/);
      if (match) {
        var num = parseInt(match[1]);
        if (num === i + 1) {
          sequentialCount++;
        }
      }
    }
    hasNumberedFormat = sequentialCount >= 2;
  }

  // Check for "название компании - NAME" format
  var hasCompanyFormat = lines.some(function(line) {
    return /^(название компании|company name|название|name)\s*[-:]\s*/i.test(line);
  });

  // Handle "название компании - NAME" format
  if (hasCompanyFormat) {
    console.log('📋 Detected company name format');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var match = line.match(/^(название компании|company name|название|name)\s*[-:]\s*(.+)$/i);
      if (match) {
        data.declarant_name = match[2].trim();
        console.log('✅ Found declarant name from format: ' + data.declarant_name);
      }
    }
    return { data: data };
  }

  if (hasNumberedFormat && !hasFieldFormat) {
    console.log('📋 Detected numbered list format');

    // Parse numbered list - extract values by position
    var values = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      // Remove number prefix (1., 2., etc.) - handle special Unicode whitespace
      var value = line.replace(/^\d+[.\)]+[\s\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u2060]*/, '').trim();
      if (value && value !== 'al1khan' && value !== 'al1khan' && !value.toLowerCase().includes('кодовое')) {
        values.push(value);
        console.log(`🔍 Значение ${values.length}: "${value.substring(0, 40)}..."`);
      }
    }

    console.log('📋 Всего значений:', values.length);

    // Map values to fields based on position
    if (values.length >= 1) data.declarant_name = values[0];
    if (values.length >= 2) data.declarant_inn = values[1].replace(/\D/g, '');
    if (values.length >= 3) data.declarant_address = values[2];
    if (values.length >= 4) data.exporter_name = values[3];
    if (values.length >= 5) {
      var country = values[4].toUpperCase();
      if (country.includes('USA')) data.exporter_country = 'US';
      else if (country.includes('CHINA') || country.includes('КИТАЙ')) data.exporter_country = 'CN';
      else if (country.includes('KAZAKHSTAN') || country.includes('КАЗАХСТАН')) data.exporter_country = 'KZ';
      else if (country.includes('TURKEY') || country.includes('ТУРЦИЯ')) data.exporter_country = 'TR';
      else if (country.includes('UAE') || country.includes('ОАЭ')) data.exporter_country = 'AE';
      else data.exporter_country = country.substring(0, 2);
    }
    if (values.length >= 6) {
      var possibleCurrency = values[5].toUpperCase();
      // Only set as currency if it's a valid currency code
      var validCurrencies = ['USD', 'EUR', 'CNY', 'KZT', 'RUB', 'GBP', 'JPY', 'TRY', 'AED', 'SAR', 'THB', 'INR', 'BRL', 'MXN', 'CAD', 'AUD'];
      if (validCurrencies.includes(possibleCurrency)) {
        data.currency = possibleCurrency;
      }
    }
    if (values.length >= 7) data.total_invoice_amount = values[6].replace(/[^\d.]/g, '');
    if (values.length >= 8) data.invoice_number = values[7];
    if (values.length >= 9) data.contract_number = values[8];
    if (values.length >= 10) {
      var parsedGross = values[9].replace(/[^\d.]/g, '');
      console.log('🔍 [Position 10] Parsed gross_weight: ' + parsedGross);
      data.gross_weight = parsedGross;
    }
    if (values.length >= 11) {
      // Goods name - with validation
      var goodName = values[10];
      var cleanedGoodName = cleanGoodsName(goodName);
      
      // Apply semantic check
      if (!isValidGoodsName(cleanedGoodName, data)) {
        console.log('⚠️ Numbered format goods name failed validation, using cleaned version: ' + cleanedGoodName);
      }
      
      data.goods.push({
        name: cleanedGoodName,
        quantity: values.length >= 12 ? values[11].replace(/[^\d.]/g, '') : '1',
        unit: values.length >= 12 && values[11].includes('шт') ? 'шт' : 'шт',
        gross_weight: data.gross_weight || '1',
        net_weight: data.net_weight || '', // Use parsed net_weight only, no fallback to prevent variable confusion
        origin_country: values.length >= 17 ? values[16] : data.exporter_country || 'CN',
        total_price: data.total_invoice_amount || '0'
      });
    }
    if (values.length >= 13) data.delivery_terms = values[12].toUpperCase();
    if (values.length >= 14) data.border_crossing = values[13];
    if (values.length >= 15) data.transport_id = values[14];
    if (values.length >= 16) data.document_code = values[15];
    if (values.length >= 17) data.financial_doc = values[16];
    if (values.length >= 18) {
      var grossWeightLine = values[17];
      var grossWeightMatch = grossWeightLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
      data.gross_weight = grossWeightMatch ? grossWeightMatch[1].replace(',', '.') : grossWeightLine.replace(/[^\d.]/g, '');
    }
    if (values.length >= 19) {
      var netWeightLine = values[18];
      var netWeightMatch = netWeightLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
      var parsedNet = netWeightMatch ? netWeightMatch[1].replace(',', '.') : netWeightLine.replace(/[^\d.]/g, '');
      // Validation: only reject if net_weight equals packages_count specifically
      var parsedNetFloat = parseFloat(parsedNet);
      var packagesCountFloat = parseFloat(data.packages_count) || 0;
      if (parsedNetFloat && parsedNetFloat === packagesCountFloat) {
        console.log('⚠️ [CRITICAL] Parsed net_weight equals packages_count (' + parsedNetFloat + '), rejecting to prevent confusion.');
        data.net_weight = ''; // Reject if it matches package count
      } else {
        data.net_weight = parsedNet;
        console.log('✅ [Position 19] Parsed net_weight: ' + data.net_weight);
      }
    }
    if (values.length >= 20) {
      var packagesLine = values[19];
      var packagesMatch = packagesLine.match(/(\d+)\s*(\w+)/);
      if (packagesMatch) {
        data.packages_count = packagesMatch[1]; // digit for Field 6
        data.packaging_type = packagesMatch[2]; // word for Field 31
      } else {
        // fallback: extract number only
        var packagesNumberMatch = packagesLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
        data.packages_count = packagesNumberMatch ? packagesNumberMatch[1].replace(',', '.') : packagesLine.replace(/[^\d.]/g, '');
      }
    }

    console.log('✅ Numbered list parsed, fields filled:', Object.keys(data).filter(k => data[k]).length);
    return { data: data };
  }
  
  if (hasFieldFormat) {
    console.log('📋 Detected "Field: Value" format');
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      
      // Parse "Field: Value" format
      var fieldMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (fieldMatch) {
        var fieldName = fieldMatch[1].trim().toLowerCase();
        var fieldValue = fieldMatch[2].trim();
        
        console.log(`🔍 Найдено поле: "${fieldName}" = "${fieldValue.substring(0, 50)}..."`);
        
        // Skip empty values
        if (!fieldValue || fieldValue === '-') continue;
        
        console.log(`📝 Field: "${fieldName}" = "${fieldValue}"`);
        
        // Declarant fields - more specific patterns first
        if (fieldName.includes('название компании отправителя') || fieldName.includes('экспортера') || fieldName.includes('exporter')) {
          data.exporter_name = fieldValue;
          console.log(`✅ Экспортер: ${fieldValue}`);
        }
        else if (fieldName.includes('название компании') && !fieldName.includes('отправителя') && !fieldName.includes('экспортера')) {
          data.declarant_name = fieldValue;
          console.log(`✅ Декларант: ${fieldValue}`);
        }
        else if (fieldName.includes('фио декларанта')) {
          data.declarant_name = fieldValue;
          console.log(`✅ Декларант ФИО: ${fieldValue}`);
        }
        else if (fieldName.includes('бин') || fieldName.includes('иин декларанта')) {
          data.declarant_inn = fieldValue.replace(/\D/g, '');
          console.log(`✅ БИН/ИИН: ${data.declarant_inn}`);
        }
        else if (fieldName.includes('адрес декларанта') || (fieldName.includes('адрес') && !fieldName.includes('отправителя'))) {
          data.declarant_address = fieldValue;
          console.log(`✅ Адрес декларанта: ${fieldValue.substring(0, 30)}...`);
        }
        // Exporter fields
        else if (fieldName.includes('страна отправления') || fieldName.includes('country of origin')) {
          var countryMatch = fieldValue.match(/([A-Z]{2})/i);
          if (countryMatch) {
            data.exporter_country = countryMatch[1].toUpperCase();
          } else if (fieldValue.toLowerCase().includes('китай') || fieldValue.toLowerCase().includes('china')) {
            data.exporter_country = 'CN';
          } else if (fieldValue.toLowerCase().includes('казахстан')) {
            data.exporter_country = 'KZ';
          }
          console.log(`✅ Страна: ${data.exporter_country}`);
        }
        else if (fieldName.includes('адрес отправителя') || fieldName.includes('exporter address')) {
          data.exporter_address = fieldValue;
          console.log(`✅ Адрес отправителя: ${fieldValue.substring(0, 30)}...`);
        }
        // Financial fields
        else if (fieldName.includes('валюта') || fieldName.includes('currency')) {
          var currMatch = fieldValue.match(/(USD|EUR|CNY|KZT|RUB)/i);
          if (currMatch) data.currency = currMatch[1].toUpperCase();
          else if (fieldValue.toUpperCase().includes('USD')) data.currency = 'USD';
          else if (fieldValue.toUpperCase().includes('EUR')) data.currency = 'EUR';
          else if (fieldValue.toUpperCase().includes('CNY')) data.currency = 'CNY';
          else if (fieldValue.toUpperCase().includes('KZT')) data.currency = 'KZT';
          else if (fieldValue.toUpperCase().includes('RUB')) data.currency = 'RUB';
        }
        else if (fieldName.includes('общая сумма') || fieldName.includes('сумма по инвойсу') || fieldName.includes('total amount')) {
          var amount = fieldValue.replace(/[^\d.,]/g, '').replace(/,/g, '.');
          // Only set if it contains at least one digit
          if (/\d/.test(amount)) {
            data.total_invoice_amount = amount;
            if (!data.goods[0]) data.goods[0] = {};
            data.goods[0].total_price = amount;
          }
        }
        else if (fieldName.includes('условия поставки') || fieldName.includes('delivery terms') || fieldName.includes('incoterms')) {
          var termsMatch = fieldValue.match(/(CIP|FOB|EXW|DDP|CFR|CIF)/i);
          if (termsMatch) data.delivery_terms = termsMatch[1].toUpperCase();
          else if (fieldValue.toUpperCase().includes('CIP')) data.delivery_terms = 'CIP';
          else if (fieldValue.toUpperCase().includes('FOB')) data.delivery_terms = 'FOB';
          else if (fieldValue.toUpperCase().includes('EXW')) data.delivery_terms = 'EXW';
          else if (fieldValue.toUpperCase().includes('DDP')) data.delivery_terms = 'DDP';
        }
        else if (fieldName.includes('номер инвойса') || fieldName.includes('invoice')) {
          data.invoice_number = fieldValue;
        }
        else if (fieldName.includes('номер контракта') || fieldName.includes('contract')) {
          data.contract_number = fieldValue;
        }
        else if (fieldName.includes('номер транспорта') || fieldName.includes('контейнера') || fieldName.includes('ттн') || fieldName.includes('container')) {
          data.transport_id = fieldValue;
        }
        else if (fieldName.includes('код документа') || fieldName.includes('document code') || fieldName.includes('док')) {
          data.document_code = fieldValue;
        }
        // Additional fields
        else if (fieldName.includes('таможенный пост') || fieldName.includes('customs post') || fieldName.includes('border crossing')) {
          data.border_crossing = fieldValue;
        }
        else if (fieldName.includes('количество мест') || fieldName.includes('packages') || fieldName.includes('мест')) {
          var packagesMatch = fieldValue.match(/(\d+)\s*(\w+)/);
          if (packagesMatch) {
            data.packages_count = packagesMatch[1]; // digit for Field 6
            data.packaging_type = packagesMatch[2]; // word for Field 31
          } else {
            data.packages_count = fieldValue.replace(/\D/g, ''); // fallback: extract number only
          }
        }
        else if (fieldName.includes('общий вес брутто') || fieldName.includes('вес брутто') || fieldName.includes('gross weight')) {
          var weight = fieldValue.replace(/[^\d.,]/g, '').replace(/,/g, '.');
          data.gross_weight = weight;
        }
      }
    }
    
    console.log('🔍 Парсинг списка товаров...');
    
    // Parse goods list section
    var goodsSectionStarted = false;
    var goodsList = [];
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      
      console.log(`🔍 Строка ${i}: "${line.substring(0, 60)}..."`);
      
      if (line.toLowerCase().includes('список товаров') || line.toLowerCase().includes('товары')) {
        goodsSectionStarted = true;
        console.log('✅ Начало секции товаров найдено');
        continue;
      }
      
      if (goodsSectionStarted) {
        // Stop if we hit a field-like line or empty separator
        if (line.match(/^[^:]+:/) || line.toLowerCase().includes('адрес отправителя')) {
          console.log('⏹️ Конец секции товаров (найдено поле)');
          goodsSectionStarted = false;
          continue;
        }
        
        // Skip empty lines
        if (!line) continue;
        
        // Check if this looks like a goods item (has description and optionally quantity)
        console.log(`🔍 Проверка товара: "${line}"`);
        
        // Match pattern: "Product name — quantity шт." or just "Product name"
        var goodsWithQty = line.match(/^(.+?)[\s]*—[\s]*(\d+)[\s]*шт/i);
        var simpleGoods = line.match(/^([А-Яа-яA-Za-z0-9\s\(\),\.\-]+)$/);
        
        if (goodsWithQty) {
          var name = goodsWithQty[1].trim();
          var quantity = goodsWithQty[2];
          
          console.log(`✅ Найден товар с количеством: "${name}" — ${quantity} шт`);
          
          goodsList.push({
            name: name,
            quantity: quantity,
            unit: 'шт',
            gross_weight: '1',
            net_weight: '1',
            origin_country: data.exporter_country || 'CN',
            total_price: data.total_invoice_amount || ''
          });
        } else if (simpleGoods && line.length > 5 && !line.includes(':')) {
          // Simple product name without quantity marker
          var name = line.trim();
          
          console.log(`✅ Найден товар (простой формат): "${name}"`);
          
          goodsList.push({
            name: name,
            quantity: '1',
            unit: 'шт',
            gross_weight: '1',
            net_weight: '1',
            origin_country: data.exporter_country || 'CN',
            total_price: data.total_invoice_amount || ''
          });
        }
      }
    }
    
    console.log(`📦 Найдено товаров: ${goodsList.length}`);
    
    if (goodsList.length > 0) {
      data.goods = goodsList;
    } else if (!data.goods[0]) {
      // Don't create "Товар" fallback - fail gracefully
      console.log('⚠️ [Parser] No goods found in input, not creating fallback item');
      data.goods = [];
    }
    
    return data;
  }
  
  // Fallback to simple list format parsing
  console.log('📝 Using simple list format');
  return parseSimpleListFormat(text, data);
}

function parseSimpleListFormat(text, data) {
  var lines = text.split(/\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

  if (!data.goods[0]) data.goods[0] = {};

  console.log('📝 Positional parsing - lines:', lines.length);

  // Position-based mapping (as shown in form)
  // Positional values ALWAYS override natural language extraction
  // 1. Declarant name
  if (lines.length >= 1) {
    data.declarant_name = lines[0];
    console.log('✅ Position 1 (declarant_name): ' + lines[0]);
  }
  // 2. BIN/IIN
  if (lines.length >= 2) {
    var inn = lines[1].replace(/\D/g, '');
    if (inn.length === 12) {
      data.declarant_inn = inn;
      console.log('✅ Position 2 (declarant_inn): ' + inn);
    }
  }
  // 3. Declarant address
  if (lines.length >= 3) {
    data.declarant_address = lines[2];
    console.log('✅ Position 3 (declarant_address): ' + lines[2]);
  }
  // 4. Exporter name
  if (lines.length >= 4) {
    data.exporter_name = lines[3];
    console.log('✅ Position 4 (exporter_name): ' + lines[3]);
  }
  // 5. Exporter country
  if (lines.length >= 5) {
    var country = lines[4];
    var countryMap = {
      'китай': 'CN', 'china': 'CN', 'кнр': 'CN', 'cn': 'CN',
      'сша': 'US', 'usa': 'US', 'us': 'US',
      'турция': 'TR', 'turkey': 'TR', 'tr': 'TR',
      'оаэ': 'AE', 'uae': 'AE', 'ae': 'AE',
      'германия': 'DE', 'germany': 'DE', 'de': 'DE',
      'индия': 'IN', 'india': 'IN', 'in': 'IN',
      'бразилия': 'BR', 'brazil': 'BR', 'br': 'BR',
      'казахстан': 'KZ', 'kazakhstan': 'KZ', 'kz': 'KZ',
      'россия': 'RU', 'russia': 'RU', 'ru': 'RU',
      'украина': 'UA', 'ukrания': 'UA', 'ua': 'UA'
    };
    var countryKey = country.toLowerCase();
    data.exporter_country = countryMap[countryKey] || country.substring(0, 2).toUpperCase();
    console.log('✅ Position 5 (exporter_country): ' + country + ' -> ' + data.exporter_country);
  }
  // 6. Exporter address
  if (lines.length >= 6) {
    data.exporter_address = lines[5];
    console.log('✅ Position 6 (exporter_address): ' + lines[5]);
  }
  // 7. Invoice number
  if (lines.length >= 7) {
    data.invoice_number = lines[6];
    console.log('✅ Position 7 (invoice_number): ' + lines[6]);
  }
  // 8. Invoice date
  if (lines.length >= 8) {
    data.invoice_date = lines[7];
    console.log('✅ Position 8 (invoice_date): ' + lines[7]);
  }
  // 9. Invoice amount
  if (lines.length >= 9) {
    var amount = lines[8].replace(/[,\s]/g, '');
    // Only accept if it's a valid number (at least 2 digits, not just a comma)
    if (amount.match(/^\d{2,}$/) || amount.match(/^\d+\.\d+$/) || amount.match(/^\d+,\d+$/)) {
      data.total_invoice_amount = amount;
      if (data.goods[0]) data.goods[0].total_price = amount;
      console.log('✅ Position 9 (total_invoice_amount): ' + amount);
    }
  }
  // 10. Currency
  if (lines.length >= 10) {
    data.currency = lines[9].toUpperCase();
    console.log('✅ Position 10 (currency): ' + data.currency);
  }
  // 11. Contract number
  if (lines.length >= 11) {
    data.contract_number = lines[10];
    console.log('✅ Position 11 (contract_number): ' + data.contract_number);
  }
  // 12. Delivery terms
  if (lines.length >= 12) {
    data.delivery_terms = lines[11].toUpperCase();
    console.log('✅ Position 12 (delivery_terms): ' + data.delivery_terms);
  }
  // 13. Border crossing
  if (lines.length >= 13) {
    data.border_crossing = lines[12];
    console.log('✅ Position 13 (border_crossing): ' + data.border_crossing);
  }
  // 14. Transport ID
  if (lines.length >= 14) {
    data.transport_id = lines[13];
    console.log('✅ Position 14 (transport_id): ' + data.transport_id);
  }
  // 15. Document code
  if (lines.length >= 15) {
    data.document_code = lines[14];
    console.log('✅ Position 15 (document_code): ' + data.document_code);
  }
  // 16. Gross weight - FIX: Use word boundary regex to prevent concatenation
  if (lines.length >= 16) {
    var weightLine = lines[15];
    var weightMatch = weightLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
    if (weightMatch) {
      var weight = weightMatch[1].replace(',', '.');
      data.gross_weight = weight;
      if (data.goods[0]) data.goods[0].gross_weight = weight;
      console.log('✅ Position 16 (gross_weight): ' + weight);
    } else {
      var weightFallback = weightLine.replace(/[^\d.]/g, '');
      data.gross_weight = weightFallback;
      if (data.goods[0]) data.goods[0].gross_weight = weightFallback;
      console.log('✅ Position 16 (gross_weight fallback): ' + weightFallback);
    }
  }
  // 17. Net weight - FIX: Use word boundary regex to prevent concatenation
  if (lines.length >= 17) {
    var netWeightLine = lines[16];
    var netWeightMatch = netWeightLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
    if (netWeightMatch) {
      var netWeight = netWeightMatch[1].replace(',', '.');
      // Validation: only reject if net_weight equals packages_count specifically
      var netWeightFloat = parseFloat(netWeight);
      var packagesCountFloat = parseFloat(data.packages_count) || 0;
      var grossWeightFloat = parseFloat(data.gross_weight) || 0;
      
      // Additional validation: reject if net_weight is suspiciously small compared to gross_weight (likely a quantity value)
      if (netWeightFloat && netWeightFloat === packagesCountFloat) {
        console.log('⚠️ [CRITICAL] Parsed net_weight equals packages_count (' + netWeightFloat + '), rejecting to prevent confusion.');
        data.net_weight = ''; // Reject if it matches package count
      } else if (netWeightFloat && grossWeightFloat > 1000 && netWeightFloat < 100) {
        console.log('⚠️ [CRITICAL] Parsed net_weight (' + netWeightFloat + ') is too small compared to gross_weight (' + grossWeightFloat + '), likely a quantity value. Rejecting.');
        data.net_weight = ''; // Reject if it looks like a quantity
      } else {
        data.net_weight = netWeight;
        if (data.goods[0]) data.goods[0].net_weight = netWeight;
        console.log('✅ Position 17 (net_weight): ' + netWeight);
      }
    } else {
      var netWeightFallback = netWeightLine.replace(/[^\d.]/g, '');
      var netWeightFallbackFloat = parseFloat(netWeightFallback);
      var packagesCountFloat = parseFloat(data.packages_count) || 0;
      var grossWeightFloat = parseFloat(data.gross_weight) || 0;
      
      if (netWeightFallbackFloat && netWeightFallbackFloat === packagesCountFloat) {
        console.log('⚠️ [CRITICAL] Fallback net_weight equals packages_count (' + netWeightFallbackFloat + '), rejecting to prevent confusion.');
        data.net_weight = '';
      } else if (netWeightFallbackFloat && grossWeightFloat > 1000 && netWeightFallbackFloat < 100) {
        console.log('⚠️ [CRITICAL] Fallback net_weight (' + netWeightFallbackFloat + ') is too small compared to gross_weight (' + grossWeightFloat + '), likely a quantity value. Rejecting.');
        data.net_weight = '';
      } else {
        data.net_weight = netWeightFallback;
        if (data.goods[0]) data.goods[0].net_weight = netWeightFallback;
        console.log('✅ Position 17 (net_weight fallback): ' + netWeightFallback);
      }
    }
  }
  // 18. Packages count - FIX: Extract only first number with word boundary to prevent concatenation
  if (lines.length >= 18) {
    var packages = lines[17];
    // Extract digit and packaging type separately
    var packagesMatch = packages.match(/(\d+)\s*(\w+)/);
    if (packagesMatch) {
      var parsedPackagesCount = parseInt(packagesMatch[1], 10);
      // Validation: reject if packages_count is suspiciously large (likely a weight value)
      if (parsedPackagesCount > 1000) {
        console.log('⚠️ [CRITICAL] Parsed packages_count (' + parsedPackagesCount + ') is too large, likely a weight value. Rejecting.');
        data.packages_count = ''; // Reject if it looks like a weight
      } else {
        data.packages_count = packagesMatch[1]; // digit for Field 6
        data.packaging_type = packagesMatch[2]; // word for Field 31
        console.log('✅ [CRITICAL CHECK] Parsed: packages=' + data.packages_count + ', packaging_type=' + data.packaging_type);
      }
    } else {
      // Fallback: extract first number only
      var packagesNumberMatch = packages.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
      if (packagesNumberMatch) {
        var parsedPackagesFallback = parseInt(packagesNumberMatch[1].replace(',', '.'), 10);
        if (parsedPackagesFallback > 1000) {
          console.log('⚠️ [CRITICAL] Fallback packages_count (' + parsedPackagesFallback + ') is too large, likely a weight value. Rejecting.');
          data.packages_count = '';
        } else {
          data.packages_count = packagesNumberMatch[1].replace(',', '.');
          console.log('✅ Position 18 (packages_count fallback): ' + data.packages_count);
        }
      } else {
        var cleanPackagesCount = packages.replace(/\D/g, '');
        var parsedCleanPackages = parseInt(cleanPackagesCount, 10);
        if (parsedCleanPackages > 1000) {
          console.log('⚠️ [CRITICAL] Clean packages_count (' + parsedCleanPackages + ') is too large, likely a weight value. Rejecting.');
          data.packages_count = '';
        } else {
          data.packages_count = cleanPackagesCount;
          console.log('✅ Position 18 (packages_count fallback): ' + data.packages_count);
        }
      }
    }
  }
  // 19. Goods name - with intelligent validation
  if (lines.length >= 19) {
    var goodsNameCandidate = lines[18];
    var validNameFound = false;
    var maxAttempts = 5;

    for (var attempt = 0; attempt < maxAttempts && (18 + attempt) < lines.length; attempt++) {
      var candidate = lines[18 + attempt];
      
      // Clean packaging prefixes
      var cleanedCandidate = cleanGoodsName(candidate);
      
      // Semantic check
      if (isValidGoodsName(cleanedCandidate, data)) {
        data.goods[0].name = cleanedCandidate;
        console.log('✅ Position ' + (19 + attempt) + ' (goods.name): ' + cleanedCandidate);
        validNameFound = true;
        break;
      } else {
        console.log('⚠️ Line ' + (19 + attempt) + ' is not a valid goods name, skipping: ' + candidate);
      }
    }

    if (!validNameFound) {
      // Last resort: use the cleaned first candidate even if validation failed
      data.goods[0].name = cleanGoodsName(lines[18]);
      console.log('⚠️ Using fallback goods name (validation failed): ' + data.goods[0].name);
    }
  }
  // 20. Goods quantity - FIX: Use word boundary regex to prevent concatenation
  if (lines.length >= 20) {
    var qtyLine = lines[19];
    var qtyMatch = qtyLine.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\b/);
    if (qtyMatch) {
      var qty = qtyMatch[1].replace(',', '.');
      data.goods[0].quantity = qty || '1';
      console.log('✅ [CRITICAL CHECK] Parsed: packages=' + data.goods[0].quantity + ' (first number only)');
    } else {
      var qtyFallback = qtyLine.replace(/\D/g, '');
      data.goods[0].quantity = qtyFallback || '1';
      console.log('✅ Position 20 (goods.quantity fallback): ' + data.goods[0].quantity);
    }
  }
  // 21. Goods origin country
  if (lines.length >= 21) {
    var originCountry = lines[20];
    var countryMap = {
      'китай': 'CN', 'china': 'CN', 'кнр': 'CN', 'cn': 'CN',
      'сша': 'US', 'usa': 'US', 'us': 'US',
      'турция': 'TR', 'turkey': 'TR', 'tr': 'TR',
      'оаэ': 'AE', 'uae': 'AE', 'ae': 'AE',
      'германия': 'DE', 'germany': 'DE', 'de': 'DE',
      'индия': 'IN', 'india': 'IN', 'in': 'IN',
      'бразилия': 'BR', 'brazil': 'BR', 'br': 'BR',
      'казахстан': 'KZ', 'kazakhstan': 'KZ', 'kz': 'KZ',
      'россия': 'RU', 'russia': 'RU', 'ru': 'RU',
      'украина': 'UA', 'ukrания': 'UA', 'ua': 'UA'
    };
    var countryKey = originCountry.toLowerCase();
    data.goods[0].origin_country = countryMap[countryKey] || originCountry.substring(0, 2).toUpperCase();
    console.log('✅ Position 21 (goods.origin_country): ' + originCountry + ' -> ' + data.goods[0].origin_country);
  }

  // Set defaults for goods if not set (but don't default weights to 1)
  if (data.goods[0]) {
    if (!data.goods[0].unit) data.goods[0].unit = 'шт';
    if (!data.goods[0].gross_weight) data.goods[0].gross_weight = data.gross_weight || '';
    if (!data.goods[0].net_weight) data.goods[0].net_weight = data.net_weight || '';
    if (!data.goods[0].origin_country) data.goods[0].origin_country = data.exporter_country || 'CN';
  }

  // STRICT MAPPING: Set IMMUTABLE flags immediately after parsing
  if (data.gross_weight) {
    data.IMMUTABLE_GROSS_WEIGHT = data.gross_weight;
    console.log('✅ [STRICT MAPPING] gross_weight set to IMMUTABLE in parser: ' + data.IMMUTABLE_GROSS_WEIGHT);
  }
  if (data.packages_count) {
    data.IMMUTABLE_PACKAGES_COUNT = data.packages_count;
    console.log('✅ [STRICT MAPPING] packages_count set to IMMUTABLE in parser: ' + data.IMMUTABLE_PACKAGES_COUNT);
  }
  if (data.net_weight) {
    data.IMMUTABLE_NET_WEIGHT = data.net_weight;
    console.log('✅ [STRICT MAPPING] net_weight set to IMMUTABLE in parser: ' + data.IMMUTABLE_NET_WEIGHT);
  }

  return data;
}

// Smart analysis of parsed data to identify missing information
function analyzeMissingData(data) {
  var missing = [];
  var questions = [];
  var followups = [];

  // Check required fields
  if (!data.declarant_name) {
    missing.push('declarant_name');
    questions.push('🏢 *Название компании-декларанта?*');
  }

  if (!data.declarant_inn) {
    missing.push('declarant_inn');
    questions.push('🔢 *БИН/ИИН компании?*');
  } else {
    // Check if IIN looks valid (12 digits)
    var inn = data.declarant_inn.replace(/[^0-9]/g, '');
    if (inn.length !== 12) {
      followups.push('❓ БИН/ИИН декларанта "' + data.declarant_inn + '" - это правильный БИН/ИИН? (Должен быть 12 цифр)');
    }
  }

  if (!data.exporter_name) {
    missing.push('exporter_name');
    questions.push('📤 *Название отправителя/экспортера?*');
  }

  if (!data.exporter_country) {
    missing.push('exporter_country');
    questions.push('🌍 *Страна отправления?* (например: Китай, Турция, ОАЭ)');
  } else {
    // Check if country looks valid (2-3 letters)
    var country = data.exporter_country.toUpperCase().replace(/[^A-Z]/g, '');
    // Reject currency codes (USD, EUR, CNY, etc.) in country fields
    var currencyCodes = ['USD', 'EUR', 'CNY', 'RUB', 'GBP', 'JPY', 'KZT', 'TRY', 'AED', 'SAR', 'THB', 'INR', 'BRL', 'MXN', 'CAD', 'AUD'];
    if (currencyCodes.includes(country)) {
      followups.push('❓ Страна отправления "' + data.exporter_country + '" - это код валюты, а не страны. Укажите код страны (например: CN, TR, AE, KZ)');
    } else if (country.length < 2 || country.length > 3) {
      followups.push('❓ Страна отправления "' + data.exporter_country + '" - это правильный код страны? (Например: CN, TR, AE)');
    }
  }

  if (!data.goods || data.goods.length === 0 || !data.goods[0].name) {
    missing.push('goods_name');
    questions.push('📦 *Наименование товара?*');
  }

  if (!data.goods || data.goods.length === 0 || !data.goods[0].quantity) {
    missing.push('goods_quantity');
    questions.push('🔢 *Количество товара?*');
  }

  if (!data.invoice_number) {
    missing.push('invoice_number');
    questions.push('🧾 *Номер инвойса?*');
  }

  if (!data.total_invoice_amount) {
    missing.push('total_invoice_amount');
    questions.push('💰 *Сумма инвойса?*');
  } else {
    // Check if amount looks valid (number)
    var amount = data.total_invoice_amount.replace(/[^0-9.,]/g, '');
    // Only ask for confirmation if it looks like it might be valid (has digits)
    // Don't ask for clearly invalid values like "," or empty strings
    if (amount && amount.length > 0 && !amount.match(/^\d+$/) && !amount.match(/^\d+[.,]\d+$/)) {
      followups.push('❓ Сумма инвойса "' + data.total_invoice_amount + '" - это правильная сумма?');
    } else if (!amount || amount.length === 0 || amount === ',' || amount === '.') {
      // Clearly invalid - add to missing instead
      missing.push('total_invoice_amount');
      questions.push('💰 *Сумма инвойса?*');
    }
  }

  // Check for new required fields
  if (!data.delivery_terms) {
    missing.push('delivery_terms');
    questions.push('📋 *Условия поставки?* (например: CIP, FOB, EXW, DDP, CFR, CIF)');
  }

  if (!data.border_crossing) {
    missing.push('border_crossing');
    questions.push('🚧 *Орган въезда/выезда?* (таможенный пост)');
  }

  if (!data.transport_id) {
    missing.push('transport_id');
    questions.push('🚚 *Идентификация транспортного средства?* (номер контейнера/машины)');
  }

  if (!data.financial_doc) {
    missing.push('financial_doc');
    questions.push('📄 *Финансовые сведения?* (например: 02013 Железнодорожная накладная, 02031 ТТН)');
  }

  if (!data.gross_weight) {
    missing.push('gross_weight');
    questions.push('⚖️ *Вес брутто?* (кг)');
  }

  if (!data.net_weight) {
    missing.push('net_weight');
    questions.push('⚖️ *Вес нетто?* (кг)');
  }

  if (!data.packages_count) {
    missing.push('packages_count');
    questions.push('📦 *Количество мест?*');
  }

  // Check for uncertainties
  var uncertainties = [];

  if (data.goods && data.goods[0]) {
    var good = data.goods[0];

    if (!good.tnved || good.tnved.length < 10) {
      uncertainties.push('❓ *Не уверен в коде ТН ВЭД* - уточните код товара');
    }

    // Validate goods origin_country field
    if (good.origin_country) {
      var originCountry = good.origin_country.toUpperCase().replace(/[^A-Z]/g, '');
      var currencyCodes = ['USD', 'EUR', 'CNY', 'RUB', 'GBP', 'JPY', 'KZT', 'TRY', 'AED', 'SAR', 'THB', 'INR', 'BRL', 'MXN', 'CAD', 'AUD'];
      if (currencyCodes.includes(originCountry)) {
        followups.push('❓ Страна происхождения товара "' + good.origin_country + '" - это код валюты, а не страны. Укажите код страны (например: CN, KZ)');
      }
    }

    if (!good.gross_weight || good.gross_weight === '1') {
      uncertainties.push('⚖️ *Нужен точный вес брутто*');
    }

    if (good.name && good.name.length < 10) {
      uncertainties.push('📝 *Нужно более подробное описание товара*');
    }
  }

  return {
    missing: missing,
    questions: questions,
    uncertainties: uncertainties,
    followups: followups,
    hasAllData: missing.length === 0,
    partialData: missing.length > 0 && missing.length < 8
  };
}

module.exports = { parseEnhancedFormData, parseSimpleListFormat, analyzeMissingData };
