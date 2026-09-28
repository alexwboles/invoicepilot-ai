/* invoicepilot-ai server: static files + optional AI polish endpoint. Zero deps. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, 'public');
const LIB = path.join(__dirname, 'lib');
const PORT = Number(process.env.PORT) || 4176;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// Optional: polish a dunning draft with the owner's own OpenAI key. Never required.
function polishWithOpenAI(text, cb) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return cb(new Error('no key'));
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a polite billing assistant. Rewrite the payment reminder below to be clear, professional, and warm. Keep all facts (invoice number, amounts, dates) exactly the same. Return only the rewritten text.' },
      { role: 'user', content: text }
    ],
    max_tokens: 400
  });
  const req = https.request({
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, (resp) => {
    let body = '';
    resp.on('data', c => body += c);
    resp.on('end', () => {
      try {
        const j = JSON.parse(body);
        const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (out) return cb(null, out.trim());
        cb(new Error('bad response'));
      } catch (e) { cb(e); }
    });
  });
  req.on('error', cb);
  req.setTimeout(15000, () => { req.destroy(); cb(new Error('timeout')); });
  req.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/polish') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let text = '';
      try { text = JSON.parse(body).text || ''; } catch (e) {}
      if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'text required' })); return; }
      polishWithOpenAI(text, (err, out) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (err) res.end(JSON.stringify({ enhanced: false, text }));
        else res.end(JSON.stringify({ enhanced: true, text: out }));
      });
    });
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ai: !!process.env.OPENAI_API_KEY }));
    return;
  }

  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p.startsWith('/lib/')) return serveFile(res, path.join(__dirname, p));
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, file);
});

if (require.main === module) {
  server.listen(PORT, () => console.log('invoicepilot-ai on http://localhost:' + PORT));
}
module.exports = server;
