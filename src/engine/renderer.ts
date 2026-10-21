// three.js renderer, scene and lights. One canvas filling the window; the HUD is a DOM overlay on top.
import * as THREE from 'three';
import { qualityProfile } from './quality';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createStage(parent: HTMLElement): Stage {
  // Quality (engine/quality.ts): antialiasing and the shadow filter are fixed here; the pixel ratio can drop later.
  const q = qualityProfile();
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, preserveDrawingBuffer: true });
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = q.shadowType;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  parent.appendChild(renderer.domElement);
  const { scene, sun } = createScene();
  return { renderer, scene, sun };
}

/** A fresh scene with the background and lights (one per race; the renderer is shared). */
export function createScene(): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a1d14');

  scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3b22', 1.4));
  // Late-afternoon sun from the upper left (screen), shadows falling down-right like the original's sprites.
  const sun = new THREE.DirectionalLight('#fff0d0', 2.6);
  sun.position.set(-60, 42, -25);
  sun.castShadow = true;
  const map = qualityProfile().shadowMap;
  sun.shadow.mapSize.set(map, map);
  const s = sun.shadow.camera;
  s.left = -70;
  s.right = 70;
  s.top = 50;
  s.bottom = -50;
  s.near = 10;
  s.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { scene, sun };
}
