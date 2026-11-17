// One mover for the player and the bots: acceleration, friction, gravity and
// collision as a box against the world's colliders, resolved one axis at a time.
// No allocation in step: the probe box and the wish vector are reused.
import * as THREE from 'three';

const GRAVITY = 20;

export function createMover(colliders, { radius = 0.34, height = 1.72 } = {}) {
  const state = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    onGround: true,
    height,
    radius,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on
  // the floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - state.radius, y + lift, z - state.radius);
    probe.max.set(x + state.radius, y + height - lift, z + state.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // wishDir is a horizontal unit vector (or zero); speed is the target speed.
  // jump is honoured only when onGround. Returns nothing; read state.
  function step(dt, wishX, wishZ, speed, { accel = 42, friction = 9, jump = false, jumpSpeed = 6.2 } = {}) {
    wish.set(wishX, 0, wishZ);
    const blend = Math.min(1, (state.onGround ? accel : accel * 0.22) * dt / Math.max(speed, 0.01));
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - friction * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (jump && state.onGround) {
      state.velocity.y = jumpSpeed;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    const nextX = state.position.x + state.velocity.x * dt;
    if (!overlaps(nextX, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nextX;
    else state.velocity.x = 0;
    const nextZ = state.position.z + state.velocity.z * dt;
    if (!overlaps(state.position.x, state.position.y, nextZ, state.height, 0.04)) state.position.z = nextZ;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  return { state, step, overlaps };
}
