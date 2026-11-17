// Dev-only probe: load the game page in headless Chrome and report WebGL + errors.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(join(here, 'game'));
const port = 8902;
const CHROME = '/opt/meta-chromium/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  let size;
  try { const s = statSync(file); if (!s.isFile()) throw new Error(); size = s.size; } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': size });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const debugPort = 9334;
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hatch-webgl-allowed-domains-file=/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt',
  '--hatch-webgl-allowed-domains-sha256=8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6',
  '--user-data-dir=/tmp/chrome-probe', '--no-proxy-server', '--allow-file-access-from-files', '--disable-web-security', '--host-resolver-rules=MAP game.local 127.0.0.1',
  `--remote-debugging-port=${debugPort}`, '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });
async function getJson(path) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${debugPort}${path}`); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('devtools not reachable');
}
const version = await getJson('/json/version');
const targets = await getJson('/json/list');
const pageTarget = targets.find((t) => t.type === 'page');
// Open the game in a fresh target with no initiator, to dodge local-network-access checks.
const browserWs = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = rej; });
let bid = 0; const bpending = new Map();
browserWs.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bpending.has(m.id)) { bpending.get(m.id)(m); bpending.delete(m.id); } };
const bsend = (method, params = {}) => new Promise((res) => { const i = ++bid; bpending.set(i, res); browserWs.send(JSON.stringify({ id: i, method, params })); });
const created = await bsend('Target.createTarget', { url: `file://${here}game/index.html?shot=start&seed=1` });
console.log('createTarget:', JSON.stringify(created.result ?? created.error));
await new Promise((r) => setTimeout(r, 1500));
const targets2 = await getJson('/json/list');
const fresh = targets2.find((t) => t.id === created.result?.targetId) ?? targets2.find((t) => t.type === 'page' && t.url.includes('game.local'));
console.log('fresh target:', fresh?.url);
const ws = new WebSocket(fresh.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  if (msg.method === 'Log.entryAdded') logs.push('LOG ' + msg.params.entry.level + ': ' + (msg.params.entry.text ?? '') + ' ' + (msg.params.entry.url ?? ''));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
console.log('skipping Page.navigate (target created with URL)');
await new Promise((r) => setTimeout(r, 2000));
const nav2 = await send('Runtime.evaluate', { expression: `location.href = 'http://game.local:${port}/?shot=start&seed=1'` });
console.log('relocate:', JSON.stringify(nav2.result?.result ?? nav2.result).slice(0, 200));
await new Promise((r) => setTimeout(r, 6000));
const evals = [
  'document.title',
  'document.readyState',
  '!!document.querySelector("canvas")',
  'window.__shotReady',
  '(() => { try { const c = document.createElement("canvas"); const gl = c.getContext("webgl2"); return gl ? ("webgl2 ok, renderer=" + gl.getParameter(gl.RENDERER)) : "webgl2 null"; } catch (e) { return "webgl2 error: " + e.message; } })()',
  'document.body.innerText.slice(0, 600)',
];
for (const expr of evals) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(expr.slice(0, 60), '=>', JSON.stringify(r.result?.result?.value ?? r.result));
}
console.log('--- logs ---');
for (const l of logs) console.log(l);
ws.close();
chrome.kill('SIGKILL');
server.close();
process.exit(0);
