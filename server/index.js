// Swingyard server
//  - http://localhost:3000      game screen (plain HTTP, opened on the Mac)
//  - https://<LAN IP>:3443      phone controller (HTTPS is required for motion sensors)
//  - /ws on both                WebSocket relay: phones -> game screen(s)
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const MAX_PLAYERS = 4;

// ---------- LAN IP ----------
export function detectLanIps() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // link-local, not routable
      found.push({ name, address: a.address });
    }
  }
  // Prefer the usual macOS Wi-Fi / Ethernet interfaces, then private ranges.
  const rank = (f) =>
    (f.name === 'en0' ? 0 : f.name === 'en1' ? 1 : /^en\d+$/.test(f.name) ? 2 : 5) +
    (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(f.address) ? 0 : 10);
  found.sort((a, b) => rank(a) - rank(b));
  return found.map((f) => f.address);
}

// ---------- self-signed certificate ----------
function loadOrCreateCert(currentIps) {
  let ips = currentIps;
  const dir = path.join(ROOT, '.cert');
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  const metaFile = path.join(dir, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const fresh = Date.now() < meta.expires - 7 * 864e5;
    if (fresh && ips.every((ip) => meta.ips.includes(ip))) {
      return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), created: false };
    }
    // Keep recently used addresses in the new certificate too.
    ips = [...new Set([...ips, ...meta.ips])].slice(0, 8);
  } catch {
    /* no usable certificate yet */
  }
  const days = 365;
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Swingyard (local)' }], {
    days,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(metaFile, JSON.stringify({ ips, expires: Date.now() + days * 864e5 }));
  return { cert: pems.cert, key: pems.private, created: true };
}

// ---------- web app ----------
// The Mac can change networks while the server is running (hotspot -> Wi-Fi, new DHCP lease),
// so the address is re-detected on every lobby poll and the certificate is re-issued when needed.
let httpsServer = null;
let tls = null;
const net = { ips: [], ip: null, url: null, qr: null };
async function refreshNetwork() {
  const ips = detectLanIps();
  if (tls && ips.join() === net.ips.join()) return net;
  const first = !tls;
  const next = loadOrCreateCert(ips);
  if (httpsServer && (next.created || !tls)) httpsServer.setSecureContext({ key: next.key, cert: next.cert });
  tls = next;
  net.ips = ips;
  net.ip = ips[0] || null;
  net.url = net.ip ? `https://${net.ip}:${HTTPS_PORT}/controller` : null;
  net.qr = net.url
    ? await QRCode.toDataURL(net.url, { margin: 1, width: 360, color: { dark: '#14213d', light: '#ffffff' } })
    : null;
  if (!first) console.log(`  Network changed - phone controller is now at: ${net.url || '(no LAN address)'}`);
  return net;
}

const app = express();
app.disable('x-powered-by');
const noStore = { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') };
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/vendor/cannon-es', express.static(path.join(ROOT, 'node_modules/cannon-es/dist')));
app.use('/vendor/peerjs', express.static(path.join(ROOT, 'node_modules/peerjs/dist')));
app.use('/vendor/qrcode', express.static(path.join(ROOT, 'node_modules/qrcode-generator')));
app.get('/controller', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'public/controller.html'));
});
app.get('/api/info', async (_req, res) => {
  const n = await refreshNetwork();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ lanIp: n.ip, controllerUrl: n.url, qr: n.qr, httpsPort: HTTPS_PORT, maxPlayers: MAX_PLAYERS });
});
app.use(express.static(path.join(ROOT, 'public'), noStore));

// ---------- WebSocket hub ----------
const screens = new Set();
const slots = new Array(MAX_PLAYERS).fill(null); // { id, ws, ios }
const lastSlotById = new Map();

const send = (ws, obj) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
};
const toScreens = (obj) => {
  const text = JSON.stringify(obj);
  for (const s of screens) if (s.readyState === 1) s.send(text);
};
const roster = () => slots.map((s, p) => (s ? { p, ios: s.ios } : null)).filter(Boolean);

function onScreen(ws) {
  screens.add(ws);
  send(ws, { t: 'hello', players: roster() });
  for (const s of slots) if (s) send(s.ws, { t: 'screen', on: true });
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    // Screen -> phone messages: vibrate / status text. `p` omitted = all phones.
    if (msg.t === 'vibrate' || msg.t === 'status') {
      const targets = Number.isInteger(msg.p) ? [slots[msg.p]] : slots;
      for (const s of targets) if (s) send(s.ws, msg);
    }
  });
  ws.on('close', () => {
    screens.delete(ws);
    if (screens.size === 0) for (const s of slots) if (s) send(s.ws, { t: 'screen', on: false });
  });
}

function onController(ws, params) {
  const id = (params.get('id') || '').slice(0, 64) || Math.random().toString(36).slice(2);
  const ios = params.get('ios') === '1';
  let p = slots.findIndex((s) => s && s.id === id); // same phone reconnecting
  if (p >= 0) {
    const old = slots[p].ws;
    slots[p] = null;
    try {
      old.terminate();
    } catch {
      /* already gone */
    }
  } else {
    const prev = lastSlotById.get(id);
    p = prev !== undefined && !slots[prev] ? prev : slots.findIndex((s) => !s);
  }
  if (p < 0) {
    send(ws, { t: 'full' });
    ws.close();
    return;
  }
  slots[p] = { id, ws, ios };
  lastSlotById.set(id, p);
  send(ws, { t: 'slot', p, screen: screens.size > 0 });
  toScreens({ t: 'join', p, ios });
  console.log(`  phone joined as player ${p + 1}`);

  // Hot path (60-120 packets a second per phone): no JSON parse, just tag the packet with the
  // player slot and pass it straight on.
  const prefix = `{"p":${p},`;
  ws.on('message', (data) => {
    if (slots[p]?.ws !== ws) return;
    const text = data.toString();
    if (text.startsWith('{"t":"m"')) {
      const out = prefix + text.slice(1);
      for (const s of screens) if (s.readyState === 1) s.send(out);
    } else if (text.startsWith('{"t":"ping"') && text.length < 80) {
      ws.send(text.replace('"ping"', '"pong"')); // lets the phone show its round-trip time
    }
  });
  ws.on('close', () => {
    if (slots[p]?.ws !== ws) return; // replaced by a reconnect
    slots[p] = null;
    toScreens({ t: 'leave', p });
    console.log(`  player ${p + 1} phone disconnected`);
  });
}

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://x').searchParams;
    req.socket.setNoDelay(true); // send every small packet immediately instead of batching
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    if (params.get('role') === 'screen') onScreen(ws);
    else onController(ws, params);
  });
  // Drop connections that silently died (phone locked, Wi-Fi lost).
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10000);
  wss.on('close', () => clearInterval(timer));
  return wss;
}

// ---------- start ----------
await refreshNetwork();
const createdCert = tls.created;
const httpServer = http.createServer(app);
httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
attachWs(httpServer);
attachWs(httpsServer);

const fail = (port) => (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${port} is already in use. Stop the other program or set PORT / HTTPS_PORT.\n`);
  else console.error(err);
  process.exit(1);
};
httpServer.on('error', fail(HTTP_PORT));
httpsServer.on('error', fail(HTTPS_PORT));

httpServer.listen(HTTP_PORT, () => {
  httpsServer.listen(HTTPS_PORT, () => {
    console.log('\n  Swingyard is running\n');
    console.log(`  Game screen (open on this Mac):  http://localhost:${HTTP_PORT}`);
    if (net.url) console.log(`  Phone controller (scan the QR):  ${net.url}`);
    else console.log('  No LAN IP found - connect this Mac to Wi-Fi to use a phone. Keyboard and mouse still work.');
    if (createdCert) console.log('  Generated a new self-signed certificate in .cert/');
    console.log('  The phone will show a certificate warning the first time - accept it to continue.\n');
  });
});
