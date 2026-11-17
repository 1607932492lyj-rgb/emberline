// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. The game state lives in one object, `game`, which every module reads; main.js
// owns the wiring, the player's shots and grenades, and the round flow.
// ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, segmentBlocked, collideSphere, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPON_DEFS } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME } from './bomb.js';
import { createEconomy, BUY_ITEMS } from './economy.js';
import { createRounds } from './rounds.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const GRENADE_SPEED = 14;
const GRENADE_GRAVITY = 12;
const FRAG_RADIUS = 7;
const FLASH_RADIUS = 20;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bomb = createBomb(scene);
const economy = createEconomy();
const rounds = createRounds();
const fx = createFx(scene, camera);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 100;

const vitals = { health: 100, armor: 0, alive: true };
const game = {
  time: 0,
  random,
  world,
  player: { state: player.state, view: player.view, get alive() { return vitals.alive; } },
  bomb,
  rounds,
  economy,
  fx,
  audio,
  playerSpeed() {
    return player.groundSpeed();
  },
  damagePlayer(amount, fromBot, isHead) {
    if (!vitals.alive) return;
    const absorbed = Math.min(vitals.armor, amount * 0.5);
    vitals.armor -= absorbed;
    vitals.health -= amount - absorbed;
    hud.damageFlash();
    audio.hurt();
    if (vitals.health <= 0) {
      vitals.health = 0;
      vitals.alive = false;
      if (bomb.state.status === 'carried' && bomb.state.carrier === 'player') bomb.drop(player.state.position);
      hud.banner('You were eliminated', 'Watching your team finish the round');
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onKill(attacker, victim, isHead) {
    const attackerName = attacker === 'player' ? 'YOU' : attacker.name;
    hud.killFeed(attackerName, victim.name, isHead, attacker === 'player' || attacker.team === 'ember' ? 'ember' : 'ash');
    if (attacker === 'player') {
      economy.killReward();
      audio.kill();
    }
  },
  onPlant(actor) {
    const site = bomb.state.site;
    hud.banner(`Bomb planted at ${site}`, 'Defend it until it blows');
    hud.setBomb(`PLANTED ${site} — ${Math.ceil(bomb.state.fuse)}s`);
    bots.alert(SITES[site].cx, SITES[site].cz, 60, 'ash');
    audio.beep();
  },
  onDefuse() {
    hud.banner('Bomb defused', 'Ash takes the round');
  },
};
const bots = createBots(scene, world, game);
const shootables = world.shootables.concat(bots.hitMeshes);

const direction = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const grenadeHit = { nx: 0, ny: 0, nz: 0, pen: 0 };
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4 }),
  flash: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4 }),
};
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMats.frag);
  mesh.visible = false;
  scene.add(mesh);
  grenades.push({ mesh, active: false, type: 'frag', pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, bounced: false });
}

let started = false;
let frozen = false;
let buyOpen = false;
let prevFiring = false;
let overlayTimer = 0;
let overlayMode = null;
let spectateBot = null;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let blindUntil = 0;

function body() {
  return player.state;
}

function syncCamera() {
  if (!vitals.alive && spectateBot && spectateBot.alive) {
    const p = spectateBot.mover.state.position;
    camera.position.set(p.x, p.y + 1.6, p.z);
    camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body().position.x, body().position.y + player.view.eye, body().position.z);
  camera.rotation.set(player.view.pitch, player.view.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body().position.x;
  const dy = point.y - (body().position.y + player.view.eye);
  const dz = point.z - body().position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.view.yaw = Math.atan2(-dx, -dz);
  player.view.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function startRound(round) {
  rounds.startRound(round);
  bomb.reset();
  bots.reset();
  weapons.refill();
  weapons.state.grenades.flash = 0;
  weapons.state.grenades.frag = 0;
  vitals.health = 100;
  vitals.alive = true;
  spectateBot = null;
  player.spawn(0, 15, 0);
  hud.setHealth(100, vitals.armor);
  hud.setScore(rounds.state.emberScore, rounds.state.ashScore, round);
  hud.setMoney(economy.state.money);
  hud.setBomb('BOMB — YOU CARRY IT');
  hud.hideBanner();
  hud.setPlantProgress(null);
  openBuy();
}

function openBuy() {
  buyOpen = true;
  hud.showBuy(BUY_ITEMS, economy.state.money);
}

function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}

function buyItem(index) {
  const item = BUY_ITEMS[index];
  if (!item) return;
  const armor = { get value() { return vitals.armor; }, set value(v) { vitals.armor = v; } };
  if (economy.buy(item, weapons, armor)) {
    audio.buy();
    hud.setMoney(economy.state.money);
    hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
    hud.showBuy(BUY_ITEMS, economy.state.money);
  } else {
    audio.denied();
  }
}

function throwGrenade(type) {
  if (!weapons.throwGrenade(type)) return;
  const slot = grenades.find((g) => !g.active);
  if (!slot) return;
  camera.getWorldDirection(direction);
  slot.active = true;
  slot.type = type;
  slot.mesh.material = grenadeMats[type];
  slot.mesh.visible = true;
  slot.pos.copy(camera.position);
  slot.vel.copy(direction).multiplyScalar(GRENADE_SPEED);
  slot.vel.y += 3.5;
  slot.fuse = type === 'frag' ? 2.4 : 1.2;
  slot.bounced = false;
  slot.mesh.position.copy(slot.pos);
  audio.reload();
}

function explodeGrenade(slot) {
  slot.active = false;
  slot.mesh.visible = false;
  if (slot.type === 'frag') {
    fx.explosion(slot.pos);
    audio.explosion();
    bots.alert(slot.pos.x, slot.pos.z, 30, 'ash');
    bots.alert(slot.pos.x, slot.pos.z, 30, 'ember');
    const victims = [];
    if (vitals.alive) victims.push({ kind: 'player', pos: body().position });
    for (const bot of bots.bots) if (bot.alive) victims.push({ kind: 'bot', bot, pos: bot.mover.state.position });
    for (const victim of victims) {
      const dx = victim.pos.x - slot.pos.x;
      const dy = (victim.pos.y + 1) - slot.pos.y;
      const dz = victim.pos.z - slot.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > FRAG_RADIUS) continue;
      let dmg = 130 - (115 * d) / FRAG_RADIUS;
      const from = new THREE.Vector3(slot.pos.x, slot.pos.y, slot.pos.z);
      const to = new THREE.Vector3(victim.pos.x, victim.pos.y + 1, victim.pos.z);
      if (segmentBlocked(from, to, world.colliders)) dmg *= 0.5;
      if (victim.kind === 'player') game.damagePlayer(dmg, null, false);
      else bots.damage(victim.bot, dmg, false, 'player');
    }
  } else {
    const consider = (x, y, z, isPlayer, bot) => {
      const dx = x - slot.pos.x;
      const dy = y - slot.pos.y;
      const dz = z - slot.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > FLASH_RADIUS) return;
      const from = new THREE.Vector3(slot.pos.x, slot.pos.y, slot.pos.z);
      const to = new THREE.Vector3(x, y, z);
      if (segmentBlocked(from, to, world.colliders)) return;
      const strength = (1 - d / FLASH_RADIUS) * 0.9;
      if (isPlayer) {
        blindUntil = game.time + strength * 2.5;
        hud.flashScreen(strength);
      } else if (bot) {
        bot.blindUntil = game.time + strength * 2.5;
      }
    };
    if (vitals.alive) {
      camera.getWorldDirection(direction);
      const dx = slot.pos.x - camera.position.x;
      const dy = slot.pos.y - camera.position.y;
      const dz = slot.pos.z - camera.position.z;
      const facing = (dx * direction.x + dy * direction.y + dz * direction.z) / (Math.hypot(dx, dy, dz) || 1);
      if (facing > -0.2) consider(camera.position.x, camera.position.y + 1.5, camera.position.z, true, null);
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const p = bot.mover.state.position;
      consider(p.x, p.y + 1.5, p.z, false, bot);
    }
  }
}

function stepGrenades(dt) {
  for (const slot of grenades) {
    if (!slot.active) continue;
    slot.fuse -= dt;
    slot.vel.y -= GRENADE_GRAVITY * dt;
    slot.pos.addScaledVector(slot.vel, dt);
    slot.mesh.position.copy(slot.pos);
    const hit = collideSphere(slot.pos, 0.12, world.colliders, grenadeHit);
    if (hit) {
      slot.pos.x += grenadeHit.nx * grenadeHit.pen;
      slot.pos.y += grenadeHit.ny * grenadeHit.pen;
      slot.pos.z += grenadeHit.nz * grenadeHit.pen;
      const vn = slot.vel.x * grenadeHit.nx + slot.vel.y * grenadeHit.ny + slot.vel.z * grenadeHit.nz;
      if (vn < 0) {
        slot.vel.x -= 1.45 * vn * grenadeHit.nx;
        slot.vel.y -= 1.45 * vn * grenadeHit.ny;
        slot.vel.z -= 1.45 * vn * grenadeHit.nz;
      }
      slot.vel.multiplyScalar(0.55);
      if (!slot.bounced) {
        slot.bounced = true;
        if (slot.type === 'frag') slot.fuse = Math.min(slot.fuse, 1.6);
        else slot.fuse = Math.min(slot.fuse, 0.05);
      }
    }
    if (slot.pos.y < 0.09) {
      slot.pos.y = 0.09;
      if (Math.abs(slot.vel.y) > 1) slot.vel.y *= -0.4;
      else slot.vel.y = 0;
      slot.vel.x *= 0.7;
      slot.vel.z *= 0.7;
    }
    if (slot.fuse <= 0) explodeGrenade(slot);
  }
}

function shoot(spread) {
  const def = weapons.fire();
  if (!def) return false;
  camera.getWorldDirection(direction);
  muzzlePos.copy(camera.position).addScaledVector(direction, 0.6);
  muzzlePos.y -= 0.12;
  muzzlePos.x += 0.08;
  let anyHit = false;
  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = new THREE.Vector3();
    if (hit) {
      end.copy(hit.point);
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const isHead = hit.object.userData.part === 'head';
        const dmg = def.damage * (isHead ? def.headMult : 1);
        const killed = bots.damage(bot, dmg, isHead, 'player');
        hud.hitMarker(killed, shot ? 4000 : 90);
        anyHit = true;
        if (killed) fx.sparksAt(end, 6, PALETTE.accent);
      } else {
        fx.sparksAt(end, 4, PALETTE.muted);
      }
    } else {
      end.copy(camera.position).addScaledVector(dir, 60);
    }
    fx.tracer(muzzlePos, end);
  }
  player.recoil(def.recoil * (0.6 + random() * 0.4), (random() * 2 - 1) * def.recoil * 0.4);
  audio.shot(weapons.state.current);
  bots.alert(body().position.x, body().position.z, 26, 'ash');
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, def.name, weapons.state.grenades);
  return anyHit;
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) closeBuy();
  } else if (rounds.state.phase !== 'ended') {
    hud.showOverlay(started ? 'paused' : 'start', 0);
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (overlayMode === 'matchEnd') {
    overlayMode = null;
    economy.reset();
    rounds.reset();
    vitals.armor = 0;
    startRound(1);
    input.requestLock();
    return;
  }
  if (overlayMode === 'roundEnd') {
    overlayMode = null;
    startRound(rounds.state.round + 1);
    input.requestLock();
    return;
  }
  input.requestLock();
});

hud.onBuy((index) => buyItem(index));

function handleKeys() {
  const keys = input.state.keys;
  if (rounds.state.phase === 'freeze') {
    if (keys.has('KeyB') && !handleKeys._b) {
      if (buyOpen) {
        closeBuy();
        input.requestLock();
      } else {
        openBuy();
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
    handleKeys._b = keys.has('KeyB');
    if (buyOpen) {
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];
      digits.forEach((code, i) => {
        if (keys.has(code) && !handleKeys[code]) buyItem(i);
        handleKeys[code] = keys.has(code);
      });
    }
  } else {
    handleKeys._b = false;
  }
  if (rounds.state.phase === 'live' && vitals.alive) {
    const switchKeys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'dmr', Digit4: 'shotgun', Digit5: 'pistol' };
    for (const [code, id] of Object.entries(switchKeys)) {
      if (keys.has(code) && !handleKeys[code]) weapons.switchTo(id);
      handleKeys[code] = keys.has(code);
    }
    if (keys.has('KeyG') && !handleKeys._g) throwGrenade('frag');
    handleKeys._g = keys.has('KeyG');
    if (keys.has('KeyF') && !handleKeys._f) throwGrenade('flash');
    handleKeys._f = keys.has('KeyF');
  }
}

function step(dt) {
  game.time += dt;
  elapsed += dt;
  const phase = rounds.state.phase;
  if (overlayTimer > 0) {
    overlayTimer -= dt;
    if (overlayTimer <= 0 && overlayMode) {
      hud.showOverlay(overlayMode, overlayMode === 'matchEnd'
        ? `${rounds.state.emberScore} — ${rounds.state.ashScore}. ${rounds.state.matchWinner === 'ember' ? 'Ember takes the match.' : 'Ash takes the match.'}`
        : `${rounds.state.winner === 'ember' ? 'Ember' : 'Ash'} takes round ${rounds.state.round}. ${rounds.state.reason}.`);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
  if (phase !== 'ended') {
    const alive = { ember: bots.aliveCount('ember') + (vitals.alive ? 1 : 0), ash: bots.aliveCount('ash') };
    const event = rounds.step(dt, alive);
    if (event && event.event === 'live') {
      closeBuy();
      hud.banner(`Round ${rounds.state.round}`, 'Go — plant at A or B');
      hud.setBomb(bomb.state.status === 'carried' ? 'BOMB — YOU CARRY IT' : '');
    }
    if (event && event.event === 'ended') {
      const won = event.winner === 'ember';
      economy.roundReward(won);
      hud.setMoney(economy.state.money);
      hud.banner(won ? 'Round won' : 'Round lost', event.reason);
      if (won) audio.roundWin();
      else audio.roundLose();
      overlayMode = rounds.state.matchWinner ? 'matchEnd' : 'roundEnd';
      overlayTimer = 2.8;
    }
    const bombEvent = bomb.step(dt, () => audio.beep());
    if (bombEvent === 'exploded') {
      fx.explosion(bomb.state.pos);
      audio.explosion();
      const end = rounds.end('ember', 'Bomb detonated at site ' + bomb.state.site);
      if (end) {
        economy.roundReward(true);
        hud.setMoney(economy.state.money);
        hud.banner('Bomb detonated', 'Ember takes the round');
        audio.roundWin();
        overlayMode = rounds.state.matchWinner ? 'matchEnd' : 'roundEnd';
        overlayTimer = 2.8;
      }
    }
    if (phase === 'freeze' || phase === 'live') handleKeys();
    if (phase === 'live') {
      if (vitals.alive) {
        player.step(dt, input.state.keys);
        const look = input.takeLook();
        player.look(look.x, look.y);
        const firing = input.state.firing && weapons.ready();
        const def = weapons.def();
        if (firing && (def.auto || !prevFiring)) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
        prevFiring = input.state.firing;
        if (input.state.keys.has('KeyR')) {
          weapons.reload();
          audio.reload();
        }
        // Plant / defuse channel while E is held.
        if (input.state.keys.has('KeyE')) {
          const pos = body().position;
          if (bomb.state.status === 'carried' && bomb.state.carrier === 'player') {
            const result = bomb.plant('player', pos, dt);
            if (result === 'planted') game.onPlant('player');
            hud.setPlantProgress(result ? bomb.state.progress / PLANT_TIME : null);
          } else if (bomb.state.status === 'planted') {
            const result = bomb.defuse('player', pos, dt);
            if (result === 'defused') {
              game.onDefuse('player');
              const end = rounds.end('ash', 'Bomb defused');
              if (end) {
                economy.roundReward(false);
                hud.setMoney(economy.state.money);
                audio.roundLose();
                overlayMode = rounds.state.matchWinner ? 'matchEnd' : 'roundEnd';
                overlayTimer = 2.8;
              }
            }
            hud.setPlantProgress(result ? bomb.state.progress / DEFUSE_TIME : null);
          } else {
            hud.setPlantProgress(null);
          }
        } else {
          hud.setPlantProgress(null);
          bomb.state.progress = 0;
        }
        // Pick up a dropped bomb by walking over it.
        if (bomb.state.status === 'dropped') bomb.pickup('player', body().position);
      } else {
        if (!spectateBot || !spectateBot.alive) {
          spectateBot = bots.bots.find((b) => b.team === 'ember' && b.alive) ?? null;
        }
      }
      weapons.step(dt);
      bots.step(dt, game.time);
      stepGrenades(dt);
    }
  }
  fx.step(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    updateHud();
  }
  renderer.render(scene, camera);
}

function updateHud() {
  hud.setHealth(vitals.health, vitals.armor);
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setScore(rounds.state.emberScore, rounds.state.ashScore, rounds.state.round);
  hud.setCrosshair(4 + weapons.spread(player.groundSpeed()) * 500);
  const bs = bomb.state;
  if (bs.status === 'planted') hud.setBomb(`PLANTED ${bs.site} — ${Math.ceil(bs.fuse)}s`);
  else if (bs.status === 'dropped') hud.setBomb('BOMB DROPPED');
  else if (bs.status === 'carried' && bs.carrier === 'player') hud.setBomb('BOMB — YOU CARRY IT');
  else if (bs.status === 'carried') hud.setBomb('BOMB — TEAMMATE CARRIES IT');
  else hud.setBomb('');
  updateMarkers();
}

const markerVec = new THREE.Vector3();
function projectMarker(x, y, z) {
  markerVec.set(x, y, z).project(camera);
  if (markerVec.z > 1) return null;
  return {
    x: (markerVec.x * 0.5 + 0.5) * window.innerWidth,
    y: (-markerVec.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function updateMarkers() {
  const a = projectMarker(SITES.A.cx, 3.4, SITES.A.cz);
  const b = projectMarker(SITES.B.cx, 3.4, SITES.B.cz);
  hud.setSiteMarker('A', a ? a.x : 0, a ? a.y : 0, !!a, 'A · FOUNDRY');
  hud.setSiteMarker('B', b ? b.x : 0, b ? b.y : 0, !!b, 'B · SILOS');
  const bs = bomb.state;
  if (bs.status === 'dropped' || bs.status === 'planted') {
    const m = projectMarker(bs.pos.x, 1.2, bs.pos.z);
    hud.setSiteMarker('bomb', m ? m.x : 0, m ? m.y : 0, !!m, bs.status === 'planted' ? '💣 LIVE' : '💣');
  } else {
    hud.setSiteMarker('bomb', 0, 0, false, '');
  }
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  closeBuy();
  if (name === 'start') {
    startRound(1);
    body().position.set(0, 0, 14);
    player.view.yaw = 0;
    player.view.pitch = 0;
    settle(20);
    hud.showOverlay('start', 0);
  } else if (name === 'play') {
    startRound(1);
    rounds.beginLive();
    closeBuy();
    body().position.set(-12, 0, 10);
    player.view.yaw = -1.0;
    settle(30);
    const bot = bots.bots.find((b) => b.team === 'ash' && b.alive);
    if (bot) {
      const p = bot.mover.state.position;
      aimAt(new THREE.Vector3(p.x, p.y + 1.2, p.z));
      shoot(0);
      settle(6);
      shoot(0);
    }
    settle(10);
  } else if (name === 'plant') {
    startRound(1);
    rounds.beginLive();
    closeBuy();
    // A teammate carries the bomb in and plants it through the real channel.
    const carrier = bots.bots[0];
    bomb.state.carrier = carrier;
    carrier.mover.state.position.set(-16, 0, -12);
    for (let i = 0; i < 220; i++) {
      if (bomb.plant(carrier, carrier.mover.state.position, FIXED_STEP) === 'planted') break;
    }
    bomb.state.fuse = 32;
    // Watch from spawn: safe from the mid sightlines, A site in view.
    body().position.set(0, 0, 15);
    settle(120);
    aimAt(new THREE.Vector3(-16, 1.2, -12));
    settle(10);
  } else {
    startRound(1);
    rounds.beginLive();
    closeBuy();
    const end = rounds.end('ember', 'Ash team eliminated');
    void end;
    hud.setScore(1, 0, 1);
    hud.banner('Round won', 'Ash team eliminated');
    settle(20);
    hud.showOverlay('roundEnd', 'Ember takes round 1. Ash team eliminated.');
  }
  hud.setScore(rounds.state.emberScore, rounds.state.ashScore, rounds.state.round);
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    updateHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__ember = { game, startRound, bots, weapons, bomb, rounds, economy, test: { shoot: (spread = 0) => shoot(spread), settle, sync: () => syncCamera(), keys: input.state.keys, fire: (on) => { input.state.firing = on; } } };

syncCamera();
hud.setAmmo(weapons.ammo.rifle.mag, weapons.ammo.rifle.reserve, weapons.def().name, weapons.state.grenades);
hud.setMoney(economy.state.money);
if (shot) {
  runShot(shot);
} else {
  startRound(1);
  requestAnimationFrame(frame);
}
