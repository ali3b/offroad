// three.js renderer, scene and lights. One canvas filling the window; the HUD is a DOM overlay on top.
import * as THREE from 'three';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createStage(parent: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a1d14');

  scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3b22', 1.4));
  // Late-afternoon sun from the upper left (screen), shadows falling down-right like the original's sprites.
  const sun = new THREE.DirectionalLight('#fff0d0', 2.6);
  sun.position.set(-60, 42, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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
  return { renderer, scene, sun };
}
