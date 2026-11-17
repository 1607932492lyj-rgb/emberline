// The bomb: carried, dropped, planted, defused. One actor channels a plant (3 s)
// or a defuse (5 s) inside a site; the fuse runs 40 s once planted. The bomb is
// the objective beyond killing: it decides rounds the guns do not.
import * as THREE from 'three';
import { SITES } from './world.js';

export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 40;

export function createBomb(scene) {
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.14, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e5484d'), roughness: 0.4, metalness: 0.4 }),
  );
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.05, 0.06),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff7a1a'), emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 2 }),
  );
  light.position.set(0.08, 0.09, 0);
  mesh.add(body, light);
  mesh.visible = false;
  scene.add(mesh);

  const state = {
    status: 'carried', // carried | dropped | planted | exploded | defused
    carrier: 'player',
    site: null,
    pos: new THREE.Vector3(),
    fuse: FUSE_TIME,
    progress: 0,
    actor: null,
  };
  let beepAt = 0;

  function inSite(pos, siteId) {
    const site = SITES[siteId];
    return pos.x >= site.minX && pos.x <= site.maxX && pos.z >= site.minZ && pos.z <= site.maxZ;
  }

  function siteAt(pos) {
    if (inSite(pos, 'A')) return 'A';
    if (inSite(pos, 'B')) return 'B';
    return null;
  }

  return {
    state,
    siteAt,
    inSite,
    // The carrier (or a teammate) channels a plant inside a site. Returns 'planted' once.
    plant(actor, pos, dt) {
      const site = siteAt(pos);
      if (state.status !== 'carried' || state.carrier !== actor || !site) {
        state.progress = 0;
        return null;
      }
      state.progress += dt;
      if (state.progress >= PLANT_TIME) {
        state.status = 'planted';
        state.site = site;
        state.fuse = FUSE_TIME;
        state.pos.set(pos.x, 0.1, pos.z);
        state.progress = 0;
        mesh.visible = true;
        mesh.position.copy(state.pos);
        return 'planted';
      }
      return 'planting';
    },
    // A defender channels a defuse at the planted site. Returns 'defused' once.
    defuse(actor, pos, dt) {
      if (state.status !== 'planted' || !inSite(pos, state.site)) {
        state.progress = 0;
        return null;
      }
      state.progress += dt;
      if (state.progress >= DEFUSE_TIME) {
        state.status = 'defused';
        state.progress = 0;
        mesh.visible = false;
        return 'defused';
      }
      return 'defusing';
    },
    drop(pos) {
      if (state.status !== 'carried') return;
      state.status = 'dropped';
      state.carrier = null;
      state.pos.set(pos.x, 0.1, pos.z);
      state.progress = 0;
      mesh.visible = true;
      mesh.position.copy(state.pos);
    },
    pickup(actor, pos) {
      if (state.status !== 'dropped') return false;
      const dx = pos.x - state.pos.x;
      const dz = pos.z - state.pos.z;
      if (dx * dx + dz * dz > 1.2) return false;
      state.status = 'carried';
      state.carrier = actor;
      mesh.visible = false;
      return true;
    },
    // Fuse countdown; returns 'exploded' on the frame it blows.
    step(dt, onBeep) {
      if (state.status !== 'planted') return null;
      state.fuse -= dt;
      beepAt -= dt;
      const interval = state.fuse > 20 ? 1 : state.fuse > 10 ? 0.5 : 0.25;
      if (beepAt <= 0) {
        beepAt = interval;
        if (onBeep) onBeep();
      }
      if (state.fuse <= 0) {
        state.status = 'exploded';
        mesh.visible = false;
        return 'exploded';
      }
      return null;
    },
    reset() {
      state.status = 'carried';
      state.carrier = 'player';
      state.site = null;
      state.fuse = FUSE_TIME;
      state.progress = 0;
      state.actor = null;
      mesh.visible = false;
    },
  };
}
