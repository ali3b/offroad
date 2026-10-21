// Render quality for phones and slow machines. The setting (or.settings `quality`, the title menu, `?quality=`) is
// auto, low or high; auto starts low on a small touch screen (a phone) and high elsewhere, then drops to low when the
// race runs under 40 fps for 3 s. The level decides:
//   high  pixel ratio up to 2, antialiasing, a 2048 PCF-soft sun shadow map, 1200 particles, the skinned fans
//   low   pixel ratio 1, no antialiasing, a 1024 PCF shadow map, 500 particles, baked fans only
// Antialiasing and the shadow filter are fixed when the renderer is made (boot); a drop at run time changes the
// pixel ratio at once and the shadow map, particles and crowd from the next scene (the current sun's map too).
// Headless browsers (navigator.webdriver) don't run the fps watch unless a test turns it on (window.__or.quality).
import * as THREE from 'three';
import { getSettings, onSettings, type QualitySetting } from './retro';

export type QualityLevel = 'low' | 'high';

export interface QualityProfile {
  pixelRatio: number;
  antialias: boolean;
  shadowMap: number;
  shadowType: THREE.ShadowMapType;
  particles: number;
  /** Skinned, animated fans in the stands (the baked crowd stays). */
  skinnedFans: boolean;
}

const PROFILES: Record<QualityLevel, Omit<QualityProfile, 'pixelRatio'> & { maxRatio: number }> = {
  high: { maxRatio: 2, antialias: true, shadowMap: 2048, shadowType: THREE.PCFSoftShadowMap, particles: 1200, skinnedFans: true },
  low: { maxRatio: 1, antialias: false, shadowMap: 1024, shadowType: THREE.PCFShadowMap, particles: 500, skinnedFans: false },
};

/** Frame rate under which auto drops to low, and for how long (s). */
const SLOW_FPS = 40;
const SLOW_SECONDS = 3;

/** A touch screen (coarse pointer or touch events). */
export function touchCapable() {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

/** A phone-sized touch screen: the short side of the screen under 500 CSS px. */
export function smallTouchScreen() {
  return touchCapable() && Math.min(screen.width, screen.height) < 500;
}

function urlSetting(): QualitySetting | null {
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'low' || q === 'high' || q === 'auto' ? q : null;
}

export const qualitySetting = (): QualitySetting => urlSetting() ?? getSettings().quality;

let autoDropped = false;
let reason = '';

function resolve(): QualityLevel {
  const s = qualitySetting();
  if (s !== 'auto') {
    reason = 'setting';
    return s;
  }
  if (autoDropped) {
    reason = `auto: under ${SLOW_FPS} fps`;
    return 'low';
  }
  if (smallTouchScreen()) {
    reason = 'auto: small touch screen';
    return 'low';
  }
  reason = 'auto';
  return 'high';
}

let level: QualityLevel = resolve();
let watch = !navigator.webdriver;
let slowT = 0;
const listeners = new Set<(l: QualityLevel) => void>();

export const qualityLevel = () => level;

export function qualityProfile(l = level): QualityProfile {
  const p = PROFILES[l];
  return { ...p, pixelRatio: Math.min(window.devicePixelRatio || 1, p.maxRatio) };
}

/** Recompute the level (after a setting change); listeners hear about a change. */
function update() {
  const next = resolve();
  if (next === level) return;
  level = next;
  for (const fn of listeners) fn(level);
}

onSettings(() => update());

export function onQuality(fn: (l: QualityLevel) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** auto → low → high → auto (the title menu). */
export function cycleQuality() {
  const s = getSettings().quality;
  return s === 'auto' ? 'low' : s === 'low' ? 'high' : 'auto';
}

export function qualityLabel() {
  const s = qualitySetting();
  return s === 'auto' ? `AUTO (${level.toUpperCase()})` : s.toUpperCase();
}

/**
 * Per rendered frame while a race is on screen: under SLOW_FPS for SLOW_SECONDS with the setting on auto drops to
 * low (once per page). Returns true on the frame it drops.
 */
export function watchFps(fps: number, dt: number) {
  if (!watch || level === 'low' || qualitySetting() !== 'auto' || fps <= 0) {
    slowT = 0;
    return false;
  }
  slowT = fps < SLOW_FPS ? slowT + dt : 0;
  if (slowT < SLOW_SECONDS) return false;
  slowT = 0;
  autoDropped = true;
  update();
  return true;
}

/** Tests: the setting, the level and why; `watchFps` turns the fps watch on or off (off under webdriver). */
export function qualityInfo(o?: { watchFps?: boolean }) {
  if (o?.watchFps !== undefined) watch = o.watchFps;
  return { setting: qualitySetting(), level, reason, watch, profile: qualityProfile() };
}

/** Apply the level to the shared renderer (pixel ratio; the rest is read when scenes are made). */
export function applyQuality(renderer: THREE.WebGLRenderer) {
  const p = qualityProfile();
  if (renderer.getPixelRatio() !== p.pixelRatio) {
    renderer.setPixelRatio(p.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

/** A scene's sun after a level change: a new shadow map size (the map is rebuilt on the next render). */
export function applySunQuality(sun: THREE.DirectionalLight) {
  const n = qualityProfile().shadowMap;
  if (sun.shadow.mapSize.x === n) return;
  sun.shadow.mapSize.set(n, n);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}

/** The crowd on low: the skinned fans hidden (the baked, instanced crowd stays). */
export function applyCrowdQuality(root: THREE.Object3D) {
  const show = qualityProfile().skinnedFans;
  for (const child of root.children) {
    let skinned = false;
    child.traverse((o) => (skinned ||= (o as THREE.SkinnedMesh).isSkinnedMesh === true));
    if (skinned) child.visible = show;
  }
}
