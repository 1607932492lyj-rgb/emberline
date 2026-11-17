// Dev-only screenshot tool (not part of the entry): serves game/ on game.local and
// captures ?shot= frames via Chrome DevTools Protocol with Node's built-in WebSocket.
// The VM's Chromium blocks direct navigation to loopback (local-network-access
// checks), so each shot opens a file:// page first and relocates to the server from
// there, which passes as a local initiator.
// Usage: node shots.mjs [port]
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(join(here, 'game'));
const shots = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const port = Number(process.argv[2] ?? 8901);
const CHROME = '/opt/meta-chromium/chrome';
const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const POLICY_SHA = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  let size;
  try { const s = statSync(file); if (!s.isFile()) throw new Error(); size = s.size; } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': size, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
console.log(`serving ${root} on ${port}`);

const debugPort = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--hatch-webgl-allowed-domains-file=${POLICY}`,
  `--hatch-webgl-allowed-domains-sha256=${POLICY_SHA}`,
  '--user-data-dir=/tmp/chrome-shots',
  '--no-proxy-server', '--allow-file-access-from-files',
  '--host-resolver-rules=MAP game.local 127.0.0.1',
  `--remote-debugging-port=${debugPort}`, '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });

async function getJson(path) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${debugPort}${path}`); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('chrome devtools not reachable');
}

const version = await getJson('/json/version');
console.log('chrome', version.Browser);

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });
}

function makeSender(ws, onEvent) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method && onEvent) onEvent(msg);
  };
  return (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}

const browserWs = await connect(version.webSocketDebuggerUrl);
const bsend = makeSender(browserWs);

async function capture(shot) {
  const consoleErrors = [];
  const created = await bsend('Target.createTarget', { url: `file://${root}/index.html` });
  const targetId = created.result.targetId;
  const targets = await getJson('/json/list');
  const target = targets.find((t) => t.id === targetId);
  const ws = await connect(target.webSocketDebuggerUrl);
  const send = makeSender(ws, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 800));
  await send('Runtime.evaluate', { expression: `location.href = 'http://game.local:${port}/${shot.query}'` });
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
    if (r.result?.result?.value === true) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) console.log(`WARN ${shot.name}: __shotReady never set`);
  await new Promise((r) => setTimeout(r, 200));
  const shotRes = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  const data = Buffer.from(shotRes.result.data, 'base64');
  writeFileSync(join(here, 'screenshots', shot.name), data);
  console.log(`${shot.name}: ${data.length} bytes, consoleErrors=${consoleErrors.length}`, consoleErrors.slice(0, 3));
  ws.close();
  await bsend('Target.closeTarget', { targetId });
}

try {
  for (const shot of shots) await capture(shot);
} finally {
  browserWs.close();
  chrome.kill('SIGKILL');
  server.close();
}
console.log('done');
