process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');

const NVIDIA_API_KEY = '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';

const body = JSON.stringify({
  model: 'meta/llama-3.3-70b-instruct',
  max_tokens: 50,
  messages: [{ role: 'user', content: 'say hi' }]
});

const options = {
  hostname: 'integrate.api.nvidia.com',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + NVIDIA_API_KEY,
    'Content-Length': Buffer.byteLength(body)
  },
  rejectUnauthorized: false
};

console.log('Отправляю запрос...');

const req = https.request(options, function(res) {
  console.log('Статус:', res.statusCode);
  let data = '';
  res.on('data', function(chunk) { data += chunk; });
  res.on('end', function() { console.log('Ответ:', data); });
});

req.on('error', function(e) { console.error('Ошибка:', e.message); });
req.setTimeout(15000, function() { req.destroy(new Error('timeout')); });
req.write(body);
req.end();
