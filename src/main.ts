// Boot: the renderer, the truck models, audio, then the flow (game/flow.ts) on the scene picked by ?scene=:
//   (none) or ?scene=title    the title / attract screen → hints → sign-up → the season (races, shop, continues)
//   ?scene=shop               straight into the Speed Shop (the saved season, or a fresh one: &cash= &race= &colour=)
//   ?scene=race&track=<id>    a standalone 4-truck race (default `rattlesnake`); &reverse, &cpus=0..3, &autopilot
//   ?scene=test               the player's truck alone on a track (default track `test`)
//   ?scene=audio              the sound bench;  &debug = the F3 overlay
// window.__or is the test/tool handle (scripts/load-check.mjs, drive-check.mjs, race-check.mjs, season-check.mjs).
import { createStage } from './engine/renderer';
import { initKeyboard } from './engine/input';
import { createWorld } from './physics/world';
import { events } from './race/events';
import { loadTruckModels } from './race/models';
// Audio: synthesised music + SFX (src/audio), fed from the game events by bridgeAudio; M mutes.
import { getAudio } from './audio';
import { bridgeAudio } from './audio/bridge';
import { Flow } from './game/flow';

const SCENES = ['title', 'shop', 'race', 'test', 'audio'] as const;

declare global {
  interface Window {
    __or: Record<string, unknown> & { ready: boolean };
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const sceneName = params.get('scene') ?? 'title';
  window.__or = { ready: false, scene: sceneName };
  if (!(SCENES as readonly string[]).includes(sceneName)) throw new Error(`unknown scene "${sceneName}" (have: ${SCENES.join(', ')})`);
  if (sceneName === 'audio') {
    const { startAudioScene } = await import('./audio/dev-scene');
    startAudioScene(document.body);
    window.__or.ready = true;
    return;
  }

  const stage = createStage(document.body);
  // RAPIER.init() once up front (each race then gets its own world).
  const [, models] = await Promise.all([createWorld().then((w) => w.free()), loadTruckModels()]);
  initKeyboard();
  const flow = new Flow(stage.renderer, models, params);
  bridgeAudio(events, (i) => flow.race?.screenX(i) ?? 0);
  flow.installHandles(window.__or);
  window.__or.audio = getAudio();

  if (sceneName === 'race' || sceneName === 'test') await flow.standalone(sceneName);
  else if (sceneName === 'shop') flow.openShop();
  else await flow.toTitle();
  flow.resize();
  flow.loop.start();
  window.__or.ready = true;
}

boot().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;padding:16px;font:14px monospace';
  pre.textContent = `Off Road failed to start:\n${e?.stack ?? e}`;
  document.body.appendChild(pre);
});
