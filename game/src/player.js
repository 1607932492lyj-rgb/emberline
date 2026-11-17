// The player: look, crouch and jump over the shared mover. The mover owns the
// collision; this owns the eye height, the view angles and the recoil kick.
import { createMover } from './mover.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;

export function createPlayer(colliders) {
  const mover = createMover(colliders, { radius: 0.34, height: STAND_HEIGHT });
  const body = mover.state;
  const player = {
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !mover.overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    let wx = 0;
    let wz = 0;
    if (forward || strafe) {
      wx = -sin * forward + cos * strafe;
      wz = -cos * forward - sin * strafe;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len;
      wz /= len;
    }
    mover.step(dt, wx, wz, player.crouching ? CROUCH_SPEED : WALK_SPEED, {
      jump: keys.has('Space'),
    });
  }

  return {
    state: body,
    view: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    spawn(x, z, yaw) {
      body.position.set(x, 0, z);
      body.velocity.set(0, 0, 0);
      player.yaw = yaw;
      player.pitch = 0;
      player.crouching = false;
      body.height = STAND_HEIGHT;
      player.eye = STAND_EYE;
    },
  };
}
