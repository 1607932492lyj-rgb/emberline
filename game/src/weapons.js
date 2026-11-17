// The armoury: five weapons and two grenades, one view model each, and the firing
// discipline — magazines, reloads, spread that grows with movement, recoil.
// It owns the numbers; main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  pistol: { name: "P9 Sidearm", price: 0, damage: 28, headMult: 4, mag: 12, reserve: 36, gap: 0.16, reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, auto: false, recoil: 0.008, pellets: 1 },
  rifle: { name: "VK-7 'Cinder'", price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, recoil: 0.011, pellets: 1 },
  smg: { name: 'Hail-9', price: 1500, damage: 26, headMult: 4, mag: 32, reserve: 96, gap: 0.07, reload: 1.7, spreadStill: 0.003, spreadMove: 0.03, auto: true, recoil: 0.007, pellets: 1 },
  dmr: { name: 'Longshot', price: 2900, damage: 88, headMult: 4, mag: 10, reserve: 40, gap: 0.55, reload: 2.4, spreadStill: 0.0008, spreadMove: 0.04, auto: false, recoil: 0.03, pellets: 1 },
  shotgun: { name: 'Breach-12', price: 1100, damage: 12, headMult: 2, mag: 6, reserve: 24, gap: 0.8, reload: 2.6, spreadStill: 0.02, spreadMove: 0.035, auto: false, recoil: 0.035, pellets: 8 },
};

export const GRENADE_DEFS = {
  flash: { name: 'Glare flash', price: 200, max: 2 },
  frag: { name: 'Ember frag', price: 300, max: 2 },
};

const SWITCH_TIME = 0.35;
const MOVE_REFERENCE = 5.2;
const MUZZLE_TIME = 0.06;

function buildModel(id) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });
  const group = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  // Each weapon reads as its own silhouette at a glance.
  if (id === 'pistol') {
    part(0.05, 0.09, 0.22, 0, 0, -0.1, body);
    part(0.045, 0.12, 0.06, 0, -0.08, 0.03, grip);
  } else if (id === 'rifle') {
    part(0.09, 0.1, 0.42, 0, 0, 0, body);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.38, grip);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip);
    part(0.05, 0.04, 0.12, 0, 0.07, -0.1, accent);
  } else if (id === 'smg') {
    part(0.08, 0.09, 0.3, 0, 0, 0, body);
    part(0.04, 0.04, 0.24, 0, 0.02, -0.24, grip);
    part(0.06, 0.14, 0.07, 0, -0.09, 0.05, grip);
  } else if (id === 'dmr') {
    part(0.08, 0.09, 0.5, 0, 0, -0.05, body);
    part(0.04, 0.04, 0.42, 0, 0.02, -0.42, grip);
    part(0.05, 0.06, 0.16, 0, 0.08, -0.08, accent);
    part(0.07, 0.07, 0.2, 0, -0.02, 0.32, grip);
  } else {
    part(0.1, 0.11, 0.38, 0, 0, 0, body);
    part(0.07, 0.07, 0.3, 0, 0.03, -0.3, grip);
    part(0.08, 0.09, 0.2, 0, -0.03, 0.28, grip);
  }
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapons(camera) {
  const models = {};
  for (const id of Object.keys(WEAPON_DEFS)) {
    models[id] = buildModel(id);
    models[id].visible = false;
    camera.add(models[id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const [id, def] of Object.entries(WEAPON_DEFS)) ammo[id] = { mag: def.mag, reserve: def.reserve };
  const state = {
    current: 'rifle',
    owned: new Set(['pistol', 'rifle']),
    grenades: { flash: 0, frag: 0 },
    cooldown: 0,
    reloadLeft: 0,
    switchLeft: 0,
    flash: 0,
    kick: 0,
  };
  models[state.current].visible = true;

  function def() {
    return WEAPON_DEFS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.switchLeft > 0) {
      state.switchLeft = Math.max(0, state.switchLeft - dt);
      model.position.y = -0.2 - 0.12 * Math.sin((state.switchLeft / SWITCH_TIME) * Math.PI);
    }
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, ((d.reload - state.reloadLeft) / d.reload) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - ammo[state.current].mag;
        const take = Math.min(need, ammo[state.current].reserve);
        ammo[state.current].mag += take;
        ammo[state.current].reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    def,
    step,
    ready() {
      return state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    // Returns the def when a round left the barrel, else null.
    fire() {
      const d = def();
      if (state.cooldown > 0 || state.reloadLeft > 0 || state.switchLeft > 0) return null;
      if (ammo[state.current].mag <= 0) return null;
      ammo[state.current].mag -= 1;
      state.cooldown = d.gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.03 + d.recoil;
      return d;
    },
    reload() {
      const d = def();
      const a = ammo[state.current];
      if (state.reloadLeft > 0 || a.mag === d.mag || a.reserve === 0) return;
      state.reloadLeft = d.reload;
    },
    switchTo(id) {
      if (!state.owned.has(id) || id === state.current || state.switchLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.switchLeft = SWITCH_TIME;
      state.reloadLeft = 0;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * d.spreadMove;
    },
    refill() {
      for (const [id, d] of Object.entries(WEAPON_DEFS)) {
        ammo[id].mag = d.mag;
        ammo[id].reserve = d.reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.switchLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    own(id) {
      state.owned.add(id);
      ammo[id].mag = WEAPON_DEFS[id].mag;
      ammo[id].reserve = WEAPON_DEFS[id].reserve;
    },
    hasGrenade(type) {
      return state.grenades[type] > 0;
    },
    throwGrenade(type) {
      if (state.grenades[type] <= 0) return false;
      state.grenades[type] -= 1;
      return true;
    },
  };
}
