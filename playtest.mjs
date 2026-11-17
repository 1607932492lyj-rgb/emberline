// Dev-only play test: loads the game in headless Chrome and drives it with the
// synchronous test hook (settle steps the sim without waiting on slow rendering).
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(join(here, 'game'));
const port = 8904;
const CHROME = '/opt/meta-chromium/chrome';
const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const POLICY_SHA = '8097045f0459c96c4cdc76e3a1af4e0f43f640b4b59c43d6db35e3641c0264c6';
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
const debugPort = 9335;
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--hatch-webgl-allowed-domains-file=${POLICY}`, `--hatch-webgl-allowed-domains-sha256=${POLICY_SHA}`,
  '--user-data-dir=/tmp/chrome-playtest', '--no-proxy-server', '--allow-file-access-from-files',
  '--host-resolver-rules=MAP game.local 127.0.0.1',
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
const browserWs = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = rej; });
let bid = 0; const bpending = new Map();
browserWs.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bpending.has(m.id)) { bpending.get(m.id)(m); bpending.delete(m.id); } };
const bsend = (method, params = {}) => new Promise((res) => { const i = ++bid; bpending.set(i, res); browserWs.send(JSON.stringify({ id: i, method, params })); });
const created = await bsend('Target.createTarget', { url: `file://${root}/index.html` });
await new Promise((r) => setTimeout(r, 500));
const targets = await getJson('/json/list');
const target = targets.find((t) => t.id === created.result.targetId);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Runtime.evaluate', { expression: `location.href = 'http://game.local:${port}/'` });
await new Promise((r) => setTimeout(r, 4000));
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EVAL ERROR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
  return r.result?.result?.value;
};
const botsSummary = `JSON.stringify(window.__ember.bots.bots.map(b=>[b.name, b.team, Math.round(b.mover.state.position.x), Math.round(b.mover.state.position.z), b.state, b.alive]))`;

console.log('canvas:', await evl('!!document.querySelector("canvas")'));
console.log('phase:', await evl('window.__ember.rounds.state.phase'), 'timer:', await evl('Math.round(window.__ember.rounds.state.timer * 10) / 10'));
console.log('player pos:', await evl('JSON.stringify(window.__ember.game.player.state.position)'));

// Go live, hold W for 1 sim-second, check the player moved north.
await evl('window.__ember.rounds.beginLive()');
await evl(`window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW'}))`);
await evl('window.__ember.test.settle(60)');
await evl(`window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW'}))`);
console.log('player pos after 1s W:', await evl('JSON.stringify(window.__ember.game.player.state.position)'));

// Crouch: hold Ctrl for 0.5 sim-seconds, check eye height drops.
await evl(`window.dispatchEvent(new KeyboardEvent('keydown', {code:'ControlLeft'}))`);
await evl('window.__ember.test.settle(30)');
console.log('eye while crouched:', await evl('Math.round(window.__ember.game.player.view.eye * 100) / 100'));
await evl(`window.dispatchEvent(new KeyboardEvent('keyup', {code:'ControlLeft'}))`);
await evl('window.__ember.test.settle(30)');

// Aim at an ash bot placed in the open in front of the player and fire until it
// dies (or 40 rounds), with cooldown gaps.
const fireResult = await evl(`(() => {
  const E = window.__ember;
  const target = E.bots.bots.find(b => b.team === 'ash' && b.alive);
  target.mover.state.position.set(0, 0, 10);
  target.state = 'hold';
  let shots = 0;
  while (target.alive && shots < 40) {
    const p = target.mover.state.position;
    const pp = E.game.player.state.position;
    const dx = p.x - pp.x, dy = (p.y + 1.2) - (pp.y + 1.6), dz = p.z - pp.z;
    const len = Math.hypot(dx, dy, dz);
    E.game.player.view.yaw = Math.atan2(-dx, -dz);
    E.game.player.view.pitch = Math.asin(dy / len);
    E.test.sync();
    E.test.shoot(0);
    E.test.settle(7);
    shots++;
  }
  return JSON.stringify({ shots, targetAlive: target.alive, targetHealth: target.health, ammo: E.weapons.ammo.rifle });
})()`);
console.log('fire result:', fireResult);

// Let the round run 20 sim-seconds: bots should reach sites/holds, not stall at spawn.
await evl('window.__ember.test.settle(1200)');
console.log('bots after 20s:', await evl(botsSummary));
console.log('timer:', await evl('Math.round(window.__ember.rounds.state.timer)'), 'phase:', await evl('window.__ember.rounds.state.phase'));
console.log('player health:', await evl('window.__ember.game.player ? "alive=" + window.__ember.game.player.alive : "?"'));

// Plant test: fresh round so the player is alive and carrying the bomb, then
// teleport into site A and hold E through the channel.
const plantResult = await evl(`(() => {
  const E = window.__ember;
  E.startRound(E.rounds.state.round + 1);
  E.rounds.beginLive();
  E.game.player.state.position.set(-16, 0, -12);
  E.test.keys.add('KeyE');
  E.test.settle(200);
  E.test.keys.delete('KeyE');
  return JSON.stringify({ status: E.bomb.state.status, site: E.bomb.state.site, fuse: Math.round(E.bomb.state.fuse) });
})()`);
console.log('plant result:', plantResult);
// Let the fuse run out (40s) and check the round ends with an Ember win.
await evl('window.__ember.test.settle(2400)');
console.log('after fuse: phase:', await evl('window.__ember.rounds.state.phase'), 'winner:', await evl('window.__ember.rounds.state.winner'), 'score:', await evl('JSON.stringify([window.__ember.rounds.state.emberScore, window.__ember.rounds.state.ashScore])'));
console.log('--- errors (' + errors.length + ') ---');
for (const e of errors) console.log(e);
ws.close();
browserWs.close();
chrome.kill('SIGKILL');
server.close();
process.exit(0);
