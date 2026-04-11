// TNVED.info Fetcher - Web scraping for TNVED codes from tnved.info
const { chromium } = require('playwright');

/**
 * Search TNVED codes from tnved.info website
 * @param {string} query - Product name to search
 * @returns {Promise<Array>} - Array of results with code and description
 */
async function searchTnvedInfo(query) {
  console.log('🔍 [tnved.info] Searching for: ' + query);
  
  var browser = null;
  var page = null;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    page = await browser.newPage();
    
    // Navigate to tnved.info search page
    await page.goto('https://tnved.info/search', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Try to find search input
    var searchInput = null;
    var inputSelectors = [
      'input[type="text"]',
      'input[type="search"]',
      'input[placeholder*="поиск" i]',
      'input[placeholder*="search" i]',
      'input[name*="search" i]',
      '#search',
      '.search-input'
    ];
    
    for (var i = 0; i < inputSelectors.length; i++) {
      try {
        var element = page.locator(inputSelectors[i]).first();
        if (await element.isVisible({ timeout: 1000 })) {
          searchInput = element;
          break;
        }
      } catch(e) {
        continue;
      }
    }
    
    if (!searchInput) {
      console.log('⚠️ [tnved.info] Search input not found, trying alternative approach');
      // Try to interact with the page directly
      await page.evaluate(function(q) {
        // Try to find input via JavaScript
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].type === 'text' || inputs[i].type === 'search') {
            inputs[i].value = q;
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, query);
    } else {
      await searchInput.fill(query);
      await page.keyboard.press('Enter');
    }
    
    await page.waitForTimeout(3000);
    
    // Extract TNVED codes from the page
    var results = await page.evaluate(function() {
      var codes = [];
      
      // Try to find TNVED codes in various formats
      var patterns = [
        /(\d{4}\s*\d{2}\s*\d{2}\s*\d{2})/g,  // 1234 56 78 90
        /(\d{10})/g,  // 1234567890
        /(\d{8})/g   // 12345678
      ];
      
      // Get all text content
      var bodyText = document.body.innerText;
      
      // Find all code matches
      var seenCodes = new Set();
      patterns.forEach(function(pattern) {
        var matches = bodyText.match(pattern);
        if (matches) {
          matches.forEach(function(match) {
            var cleanCode = match.replace(/\s/g, '');
            if (cleanCode.length >= 8 && !seenCodes.has(cleanCode)) {
              seenCodes.add(cleanCode);
              
              // Try to find description near the code
              var description = 'Описание не найдено';
              codes.push({
                code: cleanCode,
                description: description,
                source: 'tnved.info'
              });
            }
          });
        }
      });
      
      return codes;
    });
    
    console.log('✅ [tnved.info] Found ' + results.length + ' codes');
    if (results.length > 0) {
      console.log('✅ [tnved.info] Taking first code: ' + results[0].code);
      return results[0]; // Return first code only
    }
    return null;
    
  } catch(e) {
    console.error('❌ [tnved.info] Error:', e.message);
    return [];
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

/**
 * Generate search variations for better matching
 * @param {string} query - Original product name
 * @returns {Array} - Array of search variations
 */
function generateSearchVariations(query) {
  var variations = [];
  var queryLower = query.toLowerCase();
  
  // 1. Original query
  variations.push(query);
  
  // 2. Extract key words (remove stop words)
  var stopWords = ['для', 'и', 'в', 'на', 'с', 'по', 'к', 'от', 'из', 'или', 'а', 'но', 'же', 'с', 'the', 'for', 'with', 'and'];
  var keywords = queryLower.split(' ').filter(function(word) {
    return word.length > 2 && !stopWords.includes(word);
  });
  
  // 3. First keyword only
  if (keywords.length > 0) {
    variations.push(keywords[0]);
  }
  
  // 4. First two keywords
  if (keywords.length > 1) {
    variations.push(keywords[0] + ' ' + keywords[1]);
  }
  
  // 5. Remove common suffixes/prefixes
  var cleaned = queryLower
    .replace(/^(модель|тип|вид|система|устройство|прибор|аппарат)\s*/i, '')
    .replace(/\s*(модель|тип|вид|система|устройство|прибор|аппарат)$/i, '');
  if (cleaned !== queryLower) {
    variations.push(cleaned);
  }
  
  // 6. Russian to English synonyms (basic mapping)
  var synonyms = {
    'кондиционер': 'conditioner',
    'система': 'system',
    'устройство': 'device',
    'прибор': 'device',
    'аппарат': 'device',
    'панель': 'panel',
    'модуль': 'module',
    'батарея': 'battery',
    'аккумулятор': 'battery',
    'инвертор': 'inverter',
    'преобразователь': 'converter'
  };
  
  var englishVariation = queryLower;
  Object.keys(synonyms).forEach(function(russian) {
    englishVariation = englishVariation.replace(new RegExp(russian, 'gi'), synonyms[russian]);
  });
  if (englishVariation !== queryLower) {
    variations.push(englishVariation);
  }
  
  // Remove duplicates
  return variations.filter(function(v, i, self) {
    return self.indexOf(v) === i;
  });
}

module.exports = {
  searchTnvedInfo: searchTnvedInfo,
  generateSearchVariations: generateSearchVariations
};
