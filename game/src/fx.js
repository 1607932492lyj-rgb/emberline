// Effects: pooled tracers, impact sparks and the bomb's blast. Pools are fixed
// size and reused, so a firefight makes no new objects.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 12;
const SPARKS = 40;

export function createFx(scene, camera) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false });
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACERS; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  const sparkGeo = new THREE.TetrahedronGeometry(0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 1 });
  const sparks = [];
  for (let i = 0; i < SPARKS; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
  }
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 30, 1.5);
  scene.add(blastLight);
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);
  const blastMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false });
  const blast = new THREE.Mesh(blastGeo, blastMat);
  blast.visible = false;
  scene.add(blast);
  let blastLife = 0;
  let tracerIndex = 0;
  let sparkIndex = 0;
  let shake = 0;
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    tracer(from, to) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACERS;
      mid.addVectors(from, to).multiplyScalar(0.5);
      dir.subVectors(to, from);
      const len = dir.length();
      slot.mesh.position.copy(mid);
      slot.mesh.lookAt(to);
      slot.mesh.scale.set(1, 1, Math.max(len, 0.1));
      slot.mesh.visible = true;
      slot.mesh.material.opacity = 0.9;
      slot.life = 0.07;
    },
    sparksAt(point, count, color) {
      for (let i = 0; i < count; i++) {
        const slot = sparks[sparkIndex];
        sparkIndex = (sparkIndex + 1) % SPARKS;
        slot.mesh.position.copy(point);
        slot.vx = (Math.random() * 2 - 1) * 3;
        slot.vy = Math.random() * 3 + 1;
        slot.vz = (Math.random() * 2 - 1) * 3;
        slot.mesh.material.color.set(color);
        slot.mesh.material.opacity = 1;
        slot.mesh.visible = true;
        slot.life = 0.35;
      }
    },
    explosion(point) {
      blast.position.copy(point);
      blast.position.y = 0.8;
      blast.visible = true;
      blastLife = 0.7;
      blastLight.position.copy(point);
      blastLight.position.y = 2;
      blastLight.intensity = 400;
      shake = 1;
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        if (slot.life <= 0) slot.mesh.visible = false;
        else slot.mesh.material.opacity = (slot.life / 0.07) * 0.9;
      }
      for (const slot of sparks) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        if (slot.life <= 0) {
          slot.mesh.visible = false;
          continue;
        }
        slot.vy -= 9 * dt;
        slot.mesh.position.x += slot.vx * dt;
        slot.mesh.position.y += slot.vy * dt;
        slot.mesh.position.z += slot.vz * dt;
        if (slot.mesh.position.y < 0.05) {
          slot.mesh.position.y = 0.05;
          slot.vy *= -0.4;
        }
        slot.mesh.material.opacity = slot.life / 0.35;
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const t = 1 - Math.max(0, blastLife) / 0.7;
        blast.scale.setScalar(1 + t * 9);
        blast.material.opacity = Math.max(0, 0.75 * (1 - t));
        blastLight.intensity = Math.max(0, 400 * (1 - t));
        if (blastLife <= 0) blast.visible = false;
      }
      shake = Math.max(0, shake - dt * 2.2);
      if (shake > 0) {
        camera.position.x += (Math.random() * 2 - 1) * 0.05 * shake;
        camera.position.y += (Math.random() * 2 - 1) * 0.05 * shake;
      }
    },
  };
}
