// The bots: nine opponents and teammates with one brain each. A bot follows its
// waypoint route, holds a position, or rotates; when it sees an enemy it engages
// with bursts, strafes and a reaction delay; it hears nearby shots and the plant,
// and the carrier plants while defenders rotate to defuse. Vision and shots are
// real segment tests against boxes, never a dice roll against a wall.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { WEAPON_DEFS } from './weapons.js';
import { PALETTE } from './palette.js';
import { ATTACKER_SPAWNS, DEFENDER_SPAWNS, SITES, segmentBlocked } from './world.js';

const EMBER_NAMES = ['Kindle', 'Flint', 'Soot', 'Tinder'];
const ASH_NAMES = ['Slate', 'Dust', 'Gravel', 'Pebble', 'Ashfall'];
const VIEW_DIST = 42;
const VIEW_DOT = 0.55;
const HEAR_DIST = 26;
const BOT_SPEED = 4.1;
const ENGAGE_SPEED = 1.9;

// Slab test of a ray against one box; returns the hit distance or -1.
function rayBox(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return -1;
    } else {
      let t1 = (min[axis] - o[axis]) / d[axis];
      let t2 = (max[axis] - o[axis]) / d[axis];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function bodyBoxes(bot) {
  const p = bot.mover.state.position;
  return {
    body: [[p.x - 0.3, p.y + 0.1, p.z - 0.3], [p.x + 0.3, p.y + 1.35, p.z + 0.3]],
    head: [[p.x - 0.16, p.y + 1.35, p.z - 0.16], [p.x + 0.16, p.y + 1.65, p.z + 0.16]],
  };
}

export function createBots(scene, world, game) {
  const hitMeshes = [];
  const bots = [];
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function buildBot(team, index, weaponId) {
    const teamColor = team === 'ember' ? PALETTE.accent : PALETTE.teal;
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#241d17'), roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6, metalness: 0.05 });
    const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), emissive: new THREE.Color(teamColor), emissiveIntensity: 1.4, roughness: 0.4 });
    const group = new THREE.Group();
    function part(w, h, d, x, y, z, mat) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    }
    part(0.16, 0.5, 0.18, -0.12, 0.25, 0, dark);
    part(0.16, 0.5, 0.18, 0.12, 0.25, 0, dark);
    const torso = part(0.52, 0.62, 0.3, 0, 0.95, 0, cloth);
    const head = part(0.26, 0.24, 0.26, 0, 1.45, 0, dark);
    part(0.2, 0.06, 0.03, 0, 1.46, -0.13, visor);
    part(0.06, 0.08, 0.5, 0.16, 1.12, -0.28, dark);
    const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color('#171310'), depthTest: false }));
    barBg.position.set(0, 1.85, 0);
    barBg.scale.set(0.62, 0.09, 1);
    const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(teamColor), depthTest: false }));
    barFg.position.set(0, 1.85, 0);
    barFg.scale.set(0.6, 0.06, 1);
    group.add(barBg, barFg);
    scene.add(group);
    const mover = createMover(world.colliders, { radius: 0.34, height: 1.72 });
    const bot = {
      id: `${team}-${index}`,
      team,
      name: team === 'ember' ? EMBER_NAMES[index] : ASH_NAMES[index],
      weaponId,
      def: WEAPON_DEFS[weaponId],
      mover,
      group,
      torso,
      head,
      barBg,
      barFg,
      health: 100,
      alive: true,
      fall: 0,
      yaw: 0,
      state: 'hold',
      path: [],
      pathIndex: 0,
      targetSite: 'A',
      holdNode: 0,
      alertX: 0,
      alertZ: 0,
      alertAt: -99,
      seenX: 0,
      seenY: 0,
      seenZ: 0,
      seenAt: -99,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      pauseUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      blindUntil: 0,
      accuracy: 0.02 + game.random() * 0.008,
      scanPhase: game.random() * Math.PI * 2,
      thinkAt: game.random() * 0.12,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    return bot;
  }

  const emberWeapons = ['rifle', 'smg', 'rifle', 'dmr'];
  const ashWeapons = ['rifle', 'rifle', 'smg', 'dmr', 'rifle'];
  for (let i = 0; i < 4; i++) bots.push(buildBot('ember', i, emberWeapons[i]));
  for (let i = 0; i < 5; i++) bots.push(buildBot('ash', i, ashWeapons[i]));

  function spawnBot(bot, x, z, yaw) {
    bot.mover.state.position.set(x, 0, z);
    bot.mover.state.velocity.set(0, 0, 0);
    bot.yaw = yaw;
    bot.health = 100;
    bot.alive = true;
    bot.fall = 0;
    bot.group.rotation.set(0, yaw, 0);
    bot.group.position.set(x, 0, z);
    bot.barBg.visible = true;
    bot.barFg.visible = true;
    bot.state = bot.team === 'ember' ? 'route' : 'hold';
    bot.path = [];
    bot.pathIndex = 0;
    bot.seenAt = -99;
    bot.alertAt = -99;
    bot.blindUntil = 0;
    bot.burstLeft = 0;
    bot.nextShotAt = 0;
  }

  function reset() {
    const emberSites = ['A', 'B', 'A', 'B'];
    const ashHolds = [17, 18, 19, 17, 18];
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const ti = bot.team === 'ember' ? i : i - 4;
      const spawn = bot.team === 'ember' ? ATTACKER_SPAWNS[ti] : DEFENDER_SPAWNS[ti];
      spawnBot(bot, spawn[0], spawn[1], bot.team === 'ember' ? 0 : Math.PI);
      if (bot.team === 'ember') {
        bot.targetSite = emberSites[ti];
        const goal = bot.targetSite === 'A' ? 9 : 14;
        bot.path = world.findPath(world.nearestNode(spawn[0], spawn[1]), goal);
        bot.pathIndex = 0;
      } else {
        bot.holdNode = ashHolds[ti];
        const node = world.nodes[bot.holdNode];
        bot.path = world.findPath(world.nearestNode(spawn[0], spawn[1]), bot.holdNode);
        bot.pathIndex = 0;
        bot.state = 'route';
      }
    }
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
    return n;
  }

  // A noise (gunfire, a blast) tells bots of one team roughly where to look.
  function alert(x, z, radius, team) {
    for (const bot of bots) {
      if (!bot.alive || bot.team !== team) continue;
      const dx = bot.mover.state.position.x - x;
      const dz = bot.mover.state.position.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      bot.alertX = x;
      bot.alertZ = z;
      bot.alertAt = game.time;
    }
  }

  function visibleEnemy(bot) {
    const p = bot.mover.state.position;
    eye.set(p.x, p.y + 1.5, p.z);
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    let best = null;
    let bestD = Infinity;
    const consider = (x, y, z, kind, ref) => {
      const dx = x - eye.x;
      const dy = y - eye.y;
      const dz = z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > VIEW_DIST || d >= bestD) return;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < VIEW_DOT) return;
      chest.set(x, y, z);
      if (segmentBlocked(eye, chest, world.colliders)) return;
      best = { kind, ref, x, y, z, d };
      bestD = d;
    };
    if (bot.team === 'ash' && game.player.alive) {
      const pp = game.player.state.position;
      consider(pp.x, pp.y + 1.2, pp.z, 'player', null);
    }
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      const op = other.mover.state.position;
      consider(op.x, op.y + 1.2, op.z, 'bot', other);
    }
    return best;
  }

  function shootAt(bot, enemy, time) {
    const p = bot.mover.state.position;
    const muzzle = tmp.set(p.x, p.y + 1.35, p.z);
    const speed = enemy.kind === 'player' ? game.playerSpeed() : 3;
    const err = bot.accuracy * (1 + enemy.d * 0.05 + speed * 0.15) * (bot.blindUntil > time ? 3 : 1);
    aimDir.set(enemy.x - muzzle.x, enemy.y - muzzle.y, enemy.z - muzzle.z).normalize();
    aimDir.x += (game.random() * 2 - 1) * err;
    aimDir.y += (game.random() * 2 - 1) * err;
    aimDir.z += (game.random() * 2 - 1) * err;
    aimDir.normalize();
    // Hit test against the target's body and head boxes.
    let hitT = Infinity;
    let hitHead = false;
    let boxes;
    if (enemy.kind === 'player') {
      const pp = game.player.state.position;
      const h = game.player.state.height;
      boxes = {
        body: [[pp.x - 0.34, pp.y, pp.z - 0.34], [pp.x + 0.34, pp.y + h - 0.35, pp.z + 0.34]],
        head: [[pp.x - 0.2, pp.y + h - 0.35, pp.z - 0.2], [pp.x + 0.2, pp.y + h, pp.z + 0.2]],
      };
    } else {
      boxes = bodyBoxes(enemy.ref);
    }
    const tBody = rayBox(muzzle.x, muzzle.y, muzzle.z, aimDir.x, aimDir.y, aimDir.z, boxes.body[0], boxes.body[1]);
    const tHead = rayBox(muzzle.x, muzzle.y, muzzle.z, aimDir.x, aimDir.y, aimDir.z, boxes.head[0], boxes.head[1]);
    if (tHead >= 0 && tHead < hitT) {
      hitT = tHead;
      hitHead = true;
    }
    if (tBody >= 0 && tBody < hitT) {
      hitT = tBody;
      hitHead = false;
    }
    const end = new THREE.Vector3();
    if (hitT !== Infinity) {
      end.copy(muzzle).addScaledVector(aimDir, hitT);
      const dmg = bot.def.damage * (hitHead ? bot.def.headMult : 1);
      if (enemy.kind === 'player') game.damagePlayer(dmg, bot, hitHead);
      else damage(enemy.ref, dmg, hitHead, bot);
    } else {
      end.copy(muzzle).addScaledVector(aimDir, 30);
    }
    game.fx.tracer(muzzle, end);
    if (hitT !== Infinity) game.fx.sparksAt(end, 3, bot.team === 'ember' ? PALETTE.accent : PALETTE.teal);
    game.audio.distantShot();
  }

  function damage(bot, amount, isHead, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.barBg.visible = false;
    bot.barFg.visible = false;
    game.onKill(attacker, bot, isHead);
    return true;
  }

  function followPath(bot, dt, speed) {
    const p = bot.mover.state.position;
    while (bot.pathIndex < bot.path.length) {
      const node = world.nodes[bot.path[bot.pathIndex]];
      const dx = node[0] - p.x;
      const dz = node[1] - p.z;
      if (dx * dx + dz * dz < 0.5) {
        bot.pathIndex += 1;
        continue;
      }
      const len = Math.hypot(dx, dz) || 1;
      const targetYaw = Math.atan2(-dx / len, -dz / len);
      let dy = targetYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += dy * Math.min(1, dt * 8);
      bot.mover.step(dt, dx / len, dz / len, speed);
      return true;
    }
    return false;
  }

  function stepBot(bot, dt, time) {
    const p = bot.mover.state.position;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      bot.group.position.y = -bot.fall * 0.08;
      return;
    }
    bot.group.position.set(p.x, p.y, p.z);
    bot.group.rotation.y = bot.yaw;
    bot.group.rotation.x = 0;
    bot.barFg.scale.x = Math.max(0.01, 0.6 * (bot.health / 100));

    // Perception, staggered by bot so one frame never tests every sightline.
    if (time >= bot.thinkAt) {
      bot.thinkAt = time + 0.12;
      const enemy = visibleEnemy(bot);
      if (enemy) {
        if (bot.seenAt < 0 || time - bot.seenAt > 2) bot.reactAt = time + 0.45 + game.random() * 0.35;
        bot.seenX = enemy.x;
        bot.seenY = enemy.y;
        bot.seenZ = enemy.z;
        bot.seenAt = time;
        bot.state = 'engage';
      } else if (bot.state === 'engage' && time - bot.seenAt > 2) {
        bot.state = bot.team === 'ember' ? 'route' : 'hold';
      }
    }

    const bomb = game.bomb.state;
    const blind = bot.blindUntil > time;

    // Objective overrides, checked before movement.
    if (bot.team === 'ember' && bomb.status === 'carried' && bomb.carrier === bot) {
      const site = SITES[bot.targetSite];
      const dx = site.cx - p.x;
      const dz = site.cz - p.z;
      if (dx * dx + dz * dz < 9 && bot.state !== 'engage') {
        bot.state = 'plant';
      }
    }
    if (bot.team === 'ember' && bomb.status === 'dropped') {
      const dx = bomb.pos.x - p.x;
      const dz = bomb.pos.z - p.z;
      if (dx * dx + dz * dz < 1.5) {
        if (game.bomb.pickup(bot, p)) bot.state = 'route';
      } else if (bot.state !== 'engage') {
        const goal = world.nearestNode(bomb.pos.x, bomb.pos.z);
        if (bot.path[bot.path.length - 1] !== goal) {
          bot.path = world.findPath(world.nearestNode(p.x, p.z), goal);
          bot.pathIndex = 0;
          bot.state = 'route';
        }
      }
    }
    if (bot.team === 'ash' && bomb.status === 'planted') {
      const site = SITES[bomb.site];
      const dx = site.cx - p.x;
      const dz = site.cz - p.z;
      if (dx * dx + dz * dz < 9 && bot.state !== 'engage') bot.state = 'defuse';
      else if (bot.state !== 'engage' && bot.state !== 'defuse') {
        const goal = world.nearestNode(site.cx, site.cz);
        if (bot.path[bot.path.length - 1] !== goal) {
          bot.path = world.findPath(world.nearestNode(p.x, p.z), goal);
          bot.pathIndex = 0;
          bot.state = 'route';
        }
      }
    }

    switch (bot.state) {
      case 'engage': {
        const dx = bot.seenX - p.x;
        const dz = bot.seenZ - p.z;
        const dist = Math.hypot(dx, dz) || 1;
        const targetYaw = Math.atan2(-dx / dist, -dz / dist);
        let dy = targetYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += dy * Math.min(1, dt * 10);
        if (time > bot.strafeUntil) {
          bot.strafeDir = game.random() < 0.5 ? -1 : 1;
          bot.strafeUntil = time + 0.7 + game.random() * 0.7;
        }
        // Attackers keep pushing toward the enemy at range instead of camping a
        // sightline; up close everyone strafes.
        if (bot.team === 'ember' && dist > 12) {
          bot.mover.step(dt, dx / dist, dz / dist, ENGAGE_SPEED);
        } else {
          const sx = (-dz / dist) * bot.strafeDir;
          const sz = (dx / dist) * bot.strafeDir;
          bot.mover.step(dt, sx, sz, ENGAGE_SPEED);
        }
        if (!blind && time >= bot.reactAt && time >= bot.nextShotAt && time >= bot.pauseUntil) {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = 3 + Math.floor(game.random() * 2);
            bot.pauseUntil = time + 0.6 + game.random() * 0.4;
          }
          const enemy = { kind: bot.team === 'ash' && game.player.alive ? 'player' : 'bot', ref: null, x: bot.seenX, y: bot.seenY, z: bot.seenZ, d: dist };
          // Re-resolve which enemy is at the seen point: prefer the player when close.
          if (enemy.kind === 'player') {
            const pp = game.player.state.position;
            const pdx = pp.x - bot.seenX;
            const pdz = pp.z - bot.seenZ;
            if (pdx * pdx + pdz * pdz > 4) enemy.kind = 'bot';
          }
          if (enemy.kind === 'bot') {
            let bestBot = null;
            let bestD = Infinity;
            for (const other of bots) {
              if (other.team === bot.team || !other.alive) continue;
              const op = other.mover.state.position;
              const ddx = op.x - bot.seenX;
              const ddz = op.z - bot.seenZ;
              const dd = ddx * ddx + ddz * ddz;
              if (dd < bestD) {
                bestD = dd;
                bestBot = other;
              }
            }
            if (bestBot) enemy.ref = bestBot;
            else {
              bot.burstLeft = 0;
              break;
            }
          }
          shootAt(bot, enemy, time);
          bot.burstLeft -= 1;
          bot.nextShotAt = time + bot.def.gap;
          if (bot.burstLeft <= 0) bot.pauseUntil = time + 0.6 + game.random() * 0.4;
        }
        break;
      }
      case 'plant': {
        const result = game.bomb.plant(bot, p, dt);
        if (result === 'planted') {
          bot.state = 'hold';
          game.onPlant(bot);
        }
        break;
      }
      case 'defuse': {
        const result = game.bomb.defuse(bot, p, dt);
        if (result === 'defused') {
          bot.state = 'hold';
          game.onDefuse(bot);
        }
        break;
      }
      case 'route': {
        if (!followPath(bot, dt, BOT_SPEED)) bot.state = 'hold';
        break;
      }
      default: {
        // Hold: scan the lane, and answer a recent alert by facing it.
        if (time - bot.alertAt < 4) {
          const dx = bot.alertX - p.x;
          const dz = bot.alertZ - p.z;
          const targetYaw = Math.atan2(-dx, -dz);
          let dy = targetYaw - bot.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          bot.yaw += dy * Math.min(1, dt * 6);
        } else {
          bot.yaw += Math.sin(time * 0.5 + bot.scanPhase) * dt * 0.5;
        }
        bot.mover.step(dt, 0, 0, 0);
        break;
      }
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    damage,
    alert,
    aliveCount,
    step(dt, time) {
      for (const bot of bots) stepBot(bot, dt, time);
      // Separation: bots never stack on each other.
      for (let i = 0; i < bots.length; i++) {
        const a = bots[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < bots.length; j++) {
          const b = bots[j];
          if (!b.alive) continue;
          const pa = a.mover.state.position;
          const pb = b.mover.state.position;
          const dx = pb.x - pa.x;
          const dz = pb.z - pa.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 0.36 && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const push = (0.6 - d) * 0.5;
            const nx = dx / d;
            const nz = dz / d;
            pa.x -= nx * push;
            pa.z -= nz * push;
            pb.x += nx * push;
            pb.z += nz * push;
          }
        }
      }
    },
  };
}
