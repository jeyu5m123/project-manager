import jwt from 'jsonwebtoken';
var clients = new Set();

export function sseHandler(req, res) {
  var token = req.query.token || req.headers.authorization?.slice(7);
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    var decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-dev-secret');
    req.userId = decoded.sub;
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); return; }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('data: {"type":"connected"}\n\n');
  clients.add(res);
  req.on('close', function () { clients.delete(res); });
}

var webhookCache = { url: null, at: 0 };

export async function broadcast(data) {
  var msg = 'data: ' + JSON.stringify(data) + '\n\n';
  clients.forEach(function (client) {
    try { client.write(msg); } catch (e) { clients.delete(client); }
  });
  try {
    if (Date.now() - webhookCache.at > 60000) {
      var { default: db } = await import('./db/index.js');
      var { rows } = await db.query("SELECT value FROM settings WHERE key = 'webhook'");
      var cfg = rows.length ? rows[0].value : null;
      webhookCache = { url: cfg && cfg.webhook_url ? cfg.webhook_url : null, at: Date.now() };
    }
    if (webhookCache.url) {
      fetch(webhookCache.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: data.type, timestamp: new Date().toISOString(), data: data }), signal: AbortSignal.timeout(3000) }).catch(function () {});
    }
  } catch (e) {}
}
