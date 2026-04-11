// TN VED fallback codes for common goods when keden.kz lookup fails
function getFallbackTnvedCode(goodsName) {
  var nameLower = (goodsName || '').toLowerCase();
  
  // Portable electric accumulators (Power Bank, batteries)
  if (nameLower.includes('батарей') || nameLower.includes('аккумулятор') || nameLower.includes('battery')) {
    return '8507 60 000 0';
  }
  // Telephones for cellular networks (smartphones, phones)
  if (nameLower.includes('телефон') || nameLower.includes('смартфон') || nameLower.includes('phone') || nameLower.includes('smartphone')) {
    return '8517 12 000 0';
  }
  // Portable digital automatic data processing machines (laptops, computers)
  if (nameLower.includes('компьютер') || nameLower.includes('ноутбук') || nameLower.includes('laptop') || nameLower.includes('computer')) {
    return '8471 30 000 0';
  }
  // Electronic integrated circuits
  if (nameLower.includes('микросхема') || nameLower.includes('чип') || nameLower.includes('chip') || nameLower.includes('circuit')) {
    return '8542 31 000 0';
  }
  // Printed circuit boards
  if (nameLower.includes('плата') || nameLower.includes('board') || nameLower.includes('pcb')) {
    return '8534 00 000 0';
  }
  // Other machines and apparatus (generic fallback)
  return '8479 00 000 0';
}

module.exports = { getFallbackTnvedCode };
