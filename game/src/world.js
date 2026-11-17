// Cinder Yard: an original dusk industrial yard, 44 x 36 m. Two bomb sites (A Foundry
// west, B Silos east), three lanes (west, mid hall, east) and two connectors, built
// from boxes. Every box is a collider for movement and a surface a bullet stops on.
// Also owns the waypoint graph the bots walk, and the segment / sphere tests the
// bots and grenades use instead of raycasting every frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 4.6;

export const SITES = {
  A: { id: 'A', name: 'Foundry', cx: -16, cz: -12, minX: -19, minZ: -15, maxX: -13, maxZ: -9 },
  B: { id: 'B', name: 'Silos', cx: 16, cz: -12, minX: 13, minZ: -15, maxX: 19, maxZ: -9 },
};

export const ATTACKER_SPAWNS = [[0, 15], [-3, 15.5], [3, 15.5], [-6, 14], [6, 14]];
export const DEFENDER_SPAWNS = [[0, -15], [-4, -15], [4, -15], [-8, -14], [8, -14]];

// Waypoint graph: [x, z] nodes, edges by index. Bots BFS over this to reach a site,
// a hold or a sound; the nodes sit on open ground so a straight walk between two
// neighbours never crosses a wall.
const NODES = [
  [0, 15], [-5, 14], [5, 14], [0, 9], [0, 0], [0, -5],
  [-14, 9], [-14, 0], [-14, -8], [-16, -12], [-8, -6],
  [14, 9], [14, 0], [14, -8], [16, -12], [8, -6],
  [0, -15], [-12, -10], [12, -10], [0, -8], [-8, 0], [8, 0],
  [1.75, 4], [-1.75, -4],
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 6], [2, 11], [3, 22], [22, 4], [4, 20], [20, 7], [4, 21], [21, 12],
  [4, 23], [23, 5], [5, 10], [5, 15], [5, 19], [10, 8], [15, 13], [10, 19], [15, 19],
  [6, 7], [7, 8], [8, 9], [8, 17], [11, 12], [12, 13], [13, 14], [13, 18],
  [9, 17], [14, 18], [16, 17], [16, 18], [16, 19], [17, 19], [18, 19],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2.2, roughness: 0.4 });
  const tealLampMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 1.6, roughness: 0.4 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(r, h, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A box collider around the drum: cheap, and the bots' tests are box based.
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - r, y - h / 2, z - r),
      new THREE.Vector3(x + r, y + h / 2, z + r),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and outer walls.
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'canvas');
  box(0.4, WALL_H, 36.4, -22.2, WALL_H / 2, 0, 'surface');
  box(0.4, WALL_H, 36.4, 22.2, WALL_H / 2, 0, 'surface');
  box(44.4, WALL_H, 0.4, 0, WALL_H / 2, -18.2, 'surface');
  box(44.4, WALL_H, 0.4, 0, WALL_H / 2, 18.2, 'surface');

  // Site plates: thin coloured slabs that read at a glance. They are not colliders.
  const plateA = box(6, 0.06, 6, SITES.A.cx, 0.03, SITES.A.cz, 'accent', false);
  plateA.receiveShadow = true;
  const plateB = box(6, 0.06, 6, SITES.B.cx, 0.03, SITES.B.cz, 'teal', false);
  plateB.receiveShadow = true;

  // A site (Foundry): raised platform and crates.
  box(6, 0.5, 5, -16, 0.25, -12, 'surface');
  box(1.2, 1.2, 1.2, -18.5, 0.6, -13.5, 'hairline');
  box(1.2, 1.2, 1.2, -13.5, 0.6, -10.5, 'hairline');
  box(1.2, 0.7, 1.2, -16, 0.35, -15.5, 'hairline');

  // B site (Silos): two drums and crates.
  cylinder(1.4, 5, 14.5, 2.5, -13.5, 'surface');
  cylinder(1.4, 5, 18, 2.5, -13.5, 'hairline');
  box(1.2, 1.2, 1.2, 16, 0.6, -10.5, 'hairline');
  box(1.2, 0.7, 1.2, 13, 0.35, -15, 'hairline');

  // Mid hall: a roofed room with staggered doors — north door west, south door east —
  // so no straight sightline runs from one spawn to the other through mid.
  box(0.5, WALL_H, 8, -3.5, WALL_H / 2, 0, 'surface');
  box(0.5, WALL_H, 8, 3.5, WALL_H / 2, 0, 'surface');
  box(1, WALL_H, 0.5, -3, WALL_H / 2, -4, 'surface');
  box(4.5, WALL_H, 0.5, 1.25, WALL_H / 2, -4, 'surface');
  box(4.5, WALL_H, 0.5, -1.25, WALL_H / 2, 4, 'surface');
  box(1, WALL_H, 0.5, 3, WALL_H / 2, 4, 'surface');
  box(1.4, 0.7, 1.4, 0, 0.35, 0, 'hairline');

  // West lane (A long) cover.
  box(1.2, 3.2, 1.2, -14, 1.6, 2, 'hairline');
  box(3.6, 1.1, 0.8, -16.5, 0.55, -4, 'hairline');
  box(1.2, 1.2, 1.2, -12, 0.6, -8, 'hairline');
  box(0.8, 1.1, 4, -8, 0.55, -9, 'hairline');
  box(1, 3, 1, -8, 1.5, -2, 'hairline');

  // East lane (B long) cover.
  box(2.4, 2.6, 6, 14, 1.3, 3, 'surface');
  box(2.4, 2.6, 5, 15.5, 1.3, -4, 'surface');
  box(0.8, 1.1, 3.6, 11.5, 0.55, 8, 'hairline');
  box(0.8, 1.1, 4, 8, 0.55, -9, 'hairline');
  box(1, 3, 1, 8, 1.5, -2, 'hairline');

  // Spawn and mid-south cover.
  box(1.6, 0.7, 1.6, -3, 0.35, 12, 'hairline');
  box(1.6, 0.7, 1.6, 3, 0.35, 12, 'hairline');
  box(1.6, 0.7, 1.6, -4, 0.35, -15, 'hairline');
  box(1.6, 0.7, 1.6, 4, 0.35, -15, 'hairline');
  box(4, 0.5, 3, 0, 0.25, 8, 'surface');

  // Barrels.
  cylinder(0.45, 1.1, -6, 0.55, 6, 'accent');
  cylinder(0.45, 1.1, 6, 0.55, 6, 'accent');
  cylinder(0.45, 1.1, -10, 0.55, -12, 'teal');
  cylinder(0.45, 1.1, 10, 0.55, -12, 'teal');

  // Lamp posts with glowing heads over the sites and mid.
  function lamp(x, z, mat) {
    box(0.18, 4.2, 0.18, x, 2.1, z, 'hairline');
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.7), mat);
    head.position.set(x, 4.25, z);
    group.add(head);
  }
  lamp(-16, -12, lampMat);
  lamp(16, -12, tealLampMat);
  lamp(-6, -8, lampMat);
  lamp(6, 12, lampMat);

  // Dusk light: a low warm sun, a cool sky fill, and amber lamps at the sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#4a5878'), new THREE.Color(PALETTE.canvas), 1.1);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.4);
  sun.position.set(-14, 16, 10);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6f96'), 0.8);
  fill.position.set(12, 10, -12);
  scene.add(fill);
  const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 16, 1.8);
  lampA.position.set(-16, 4, -12);
  scene.add(lampA);
  const lampB = new THREE.PointLight(new THREE.Color(PALETTE.teal), 18, 16, 1.8);
  lampB.position.set(16, 4, -12);
  scene.add(lampB);

  // Waypoint adjacency, built once from the edge list.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    nodes: NODES,
    adjacency,
    // BFS over the waypoint graph; returns node indices from start to goal.
    findPath(start, goal) {
      if (start === goal) return [start];
      const prev = new Int16Array(NODES.length).fill(-1);
      const queue = [start];
      prev[start] = start;
      while (queue.length) {
        const node = queue.shift();
        for (const next of adjacency[node]) {
          if (prev[next] !== -1) continue;
          prev[next] = node;
          if (next === goal) {
            const path = [goal];
            let at = goal;
            while (at !== start) {
              at = prev[at];
              path.unshift(at);
            }
            return path;
          }
          queue.push(next);
        }
      }
      return [start];
    },
    nearestNode(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < NODES.length; i++) {
        const dx = NODES[i][0] - x;
        const dz = NODES[i][1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
  };
}

// Slab test: does the segment a->b touch any box in list? No allocation.
export function segmentBlocked(a, b, list) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  for (const box of list) {
    let tmin = 0;
    let tmax = 1;
    let ok = true;
    const mins = [box.min.x, box.min.y, box.min.z];
    const maxs = [box.max.x, box.max.y, box.max.z];
    const origins = [a.x, a.y, a.z];
    const dirs = [dx, dy, dz];
    for (let axis = 0; axis < 3; axis++) {
      const dir = dirs[axis];
      if (Math.abs(dir) < 1e-9) {
        if (origins[axis] < mins[axis] || origins[axis] > maxs[axis]) {
          ok = false;
          break;
        }
      } else {
        let t1 = (mins[axis] - origins[axis]) / dir;
        let t2 = (maxs[axis] - origins[axis]) / dir;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

// Sphere vs boxes: returns the shallowest-penetration face normal, or null.
export function collideSphere(pos, radius, list, out) {
  let best = null;
  let bestPen = Infinity;
  for (const box of list) {
    const cx = Math.max(box.min.x, Math.min(pos.x, box.max.x));
    const cy = Math.max(box.min.y, Math.min(pos.y, box.max.y));
    const cz = Math.max(box.min.z, Math.min(pos.z, box.max.z));
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const dz = pos.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= radius * radius) continue;
    // Inside the box: push out along the least-penetration axis.
    if (d2 < 1e-9) {
      const px = Math.min(pos.x - box.min.x, box.max.x - pos.x);
      const py = Math.min(pos.y - box.min.y, box.max.y - pos.y);
      const pz = Math.min(pos.z - box.min.z, box.max.z - pos.z);
      if (px <= py && px <= pz) {
        out.nx = pos.x - box.min.x < box.max.x - pos.x ? -1 : 1;
        out.ny = 0;
        out.nz = 0;
        out.pen = px;
      } else if (py <= pz) {
        out.nx = 0;
        out.ny = pos.y - box.min.y < box.max.y - pos.y ? -1 : 1;
        out.nz = 0;
        out.pen = py;
      } else {
        out.nx = 0;
        out.ny = 0;
        out.nz = pos.z - box.min.z < box.max.z - pos.z ? -1 : 1;
        out.pen = pz;
      }
      return out;
    }
    const d = Math.sqrt(d2);
    const pen = radius - d;
    if (pen < bestPen) {
      bestPen = pen;
      best = out;
      out.nx = dx / d;
      out.ny = dy / d;
      out.nz = dz / d;
      out.pen = pen;
    }
  }
  return best;
}
