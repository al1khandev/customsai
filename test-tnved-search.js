// Test script for TN VED search algorithm
const CoreEngine = require('./CoreEngine.js');

// Test products
const testProducts = [
  'Беспроводные наушники с функцией измерения пульса и уровня кислорода в крови (TWS, с зарядным кейсом)',
  'Портативный автомобильный компрессор с цифровым манометром и функцией автоотключения (12V)',
  'Детский развивающий планшет с силиконовым чехлом и предустановленными обучающими программами (без SIM)',
  'Электрическая зубная щётка с ультразвуком, таймером и подключением по Bluetooth к приложению',
  'Коврик для йоги из TPE с антискользящим покрытием и толщиной 6 мм',
  'Умный термометр бесконтактный инфракрасный с подключением к телефону и памятью на 50 измерений',
  'Складной столик для ноутбука из алюминия и пластика с регулировкой высоты и охлаждающим вентилятором',
  'Набор постельного белья из сатина (4 предмета), 100% хлопок, размер евро',
  'Портативный озонатор-ионизатор воздуха для автомобиля и дома с USB-зарядкой',
  'Мужская ветровка из мембранной ткани с водоотталкивающим покрытием DWR, с капюшоном',
  // Bonus - 5 very difficult products
  'Крем для лица с пептидами, гиалуроновой кислотой и ниацинамидом (50 мл, косметика)',
  'Фитолампа для растений на прищепке, full spectrum, 30W с таймером и регулировкой яркости',
  'Велосипедные LED-фары с питанием от динамо-втулки и USB-выходом',
  'Массажёр для шеи и плеч с функцией прогрева и TENS-электростимуляцией',
  'Сушилка для фруктов и овощей электрическая 5 поддонов с таймером и регулировкой температуры'
];

async function testSearch() {
  console.log('🧪 Starting TN VED search test with 15 products (10 main + 5 bonus)\n');

  var results = {
    success: [],
    failed: []
  };

  for (var i = 0; i < testProducts.length; i++) {
    var product = testProducts[i];
    console.log('📦 Testing product ' + (i + 1) + '/15: ' + product);

    try {
      var searchResult = await CoreEngine.searchKeden(product);
      console.log('✅ SUCCESS for ' + product);
      console.log('   Found ' + searchResult.length + ' codes:');
      searchResult.forEach(function(item, index) {
        console.log('     ' + (index + 1) + '. ' + item.code + ' — ' + item.description.slice(0, 60));
      });
      results.success.push({ product: product, codes: searchResult });
    } catch(e) {
      console.log('❌ FAILED for ' + product);
      console.log('   Error: ' + e.message);
      results.failed.push({ product: product, error: e.message });
    }

    console.log('');
  }

  console.log('📊 Test Results Summary:');
  console.log('✅ Success: ' + results.success.length + '/15');
  console.log('❌ Failed: ' + results.failed.length + '/15');

  if (results.failed.length > 0) {
    console.log('\n❌ Failed products:');
    results.failed.forEach(function(item) {
      console.log('   - ' + item.product + ': ' + item.error);
    });
  }

  console.log('\n🏁 Test completed');
  return results;
}

testSearch().then(function(results) {
  console.log('\n✅ Test script completed');
}).catch(function(error) {
  console.error('❌ Test script error:', error);
  process.exit(1);
});
