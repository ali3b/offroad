# Feedback for Synty Sprite Generator

Every gap Off Road hits in the generator's CLI or MCP (mostly its 3D model export). The orchestrator triages entries
into the generator's `TODO.md` (section "3D models + Off Road", "Inbox: from Off Road"). Number the entries in order
and never reuse a number; the `OR-` prefix keeps them apart from Solitary Strike's FB-NNN and Sidefighter's SF-FB-NNN.

Status: `open` → `triaged (TODO: …)` → `fixed (<commit>)` → `verified` (the game's workaround was removed).

<!-- Template
## OR-FB-001 · <title>
- Severity: blocks | workaround | polish        Milestone: OR1
- Tried: `ssg model …` / MCP tool …
- Wanted: …
- Got: …
- Workaround: <file in this repo, tagged // OR-FB-NNN, or none>
- Suggested change: …
- Status: open
-->

## OR-FB-001 · No 3D model export yet (`ssg model apply`)
- Severity: blocks        Milestone: OR0
- Tried: `ssg --help` (no `model` command), the MCP tool list (no `export_model` / `apply_models`).
- Wanted: `ssg model apply ssg.models.json --out public/models --json` per the generator TODO "3D models + Off Road"
  contract: GLB + `.model.json` manifest per entry, `models.json` index, tints, `origin: axle-centre`, a `wheels` block.
- Got: nothing yet (being built in parallel, M0–M2).
- Workaround: `src/race/truck-view.ts` draws a placeholder box truck; `src/track/build.ts` draws primitive tyre walls.
  `scripts/build-assets.mjs` prints a notice and exits 0 while the command is missing.
- Suggested change: ship M1/M2.
- Status: verified (generator wave 16, 2026-10-21). `ssg model apply ssg.models.json --out public/models --json`
  exports all 13 models cold in ~8–11 s, re-runs download nothing, removed entries' files are deleted, no
  `warnings`. Each GLB has a single root named after the spec `name` with identity transforms (no extra root
  transform), wheel nodes sit at `wheels.pos` with identity rotation, and the lift-kit recipe gives four wheels that
  spin and steer correctly in the game. The real trucks and props replace the placeholders (`race/truck-view.ts`,
  `track/props-view.ts`); the placeholders remain only as the no-models fallback.

## OR-FB-002 · No target size for a model export (the game rescales the GLB to its physics)
- Severity: workaround        Milestone: OR2
- Tried: the spec in the generator's docs/MODELS.md (branch integrate-w16): `asset, name, clips, inPlace, attach,
  origin, texSize, texFormat, simplify, tint`.
- Wanted: a way to ask for the truck at the game's size, e.g. `"fit": { "length": 4.75 }` (or `"scale": 0.92`), so
  the GLB, its manifest `bounds`/`wheels.radius`/`collider.box` and the game's 4.5 m physics chassis agree without
  game code doing maths on the manifest. The track scale (truck ≈ 1/19 of the arena width) is fixed by the
  original's proportions, so the truck size is a design input, not whatever the Synty pickup measures.
- Got: the export is always in the model's own metres.
- Workaround: `src/race/truck-view.ts` scales the loaded GLB so `wheels.fl.pos`→`wheels.rl.pos` (4.33 m) matches
  the physics wheelbase (2.9 m) × `TRUCK_LOOK` 1.12, offsets the holder so the scaled 0.837 m wheels touch the
  ground, and divides suspension offsets by the scale (tagged `// OR-FB-002`). Re-checked with the live export
  (2026-10-21): still needed; the lifted pickup is 6.85 m long against our 4.5 m chassis.
- Suggested change: a `fit` (or `scale`) spec field / `--fit-length` flag, applied before the manifest numbers are
  computed (so wheel radius, pivots and the collider box come out scaled too).
- Status: verified (2026-10-21). The truck specs carry `"fit": { "length": 4.5 }`: the manifest comes back 4.5 m
  long, 2.53 m wide, wheels at z ±1.42 (2.85 m wheelbase against the physics 2.9 m), radius 0.55 m,
  `scale: { modelScale: 0.657, fit: { length: 4.5 } }`, no warnings. `truck-view.ts` no longer measures the
  manifest; it draws the GLB at `TRUCK_LOOK` 1.12 as a style choice and converts suspension travel through the
  wheel node's parent scale (the GLB root carries the fit). Load check: four trucks on four wheels, upright.

## OR-FB-003 · `ssg model apply --help` does not list `--json`
- Severity: polish        Milestone: OR3
- Tried: `ssg model apply --help` (shows only `--out`), then `ssg model apply ssg.models.json --out public/models --json`.
- Wanted: the `--json` flag listed in the help, as docs/MODELS.md says every command takes it.
- Got: `--json` works (stdout `{ dir, index, models: [{ name, id, action, cached, glb, manifest }] }`, the per-model
  lines on stderr), but only by trying it. `action` values seen: `written`, `updated`, `unchanged`.
- Workaround: none (`scripts/build-assets.mjs` documents the output shape it reads).
- Suggested change: add `--json` to the help of `model apply` / `export` / `info`, and document the apply summary in
  docs/MODELS.md.
- Status: triaged (TODO: OR-FB-003)

## OR-FB-004 · Default PNG textures make every prop GLB carry a whole atlas (~600 KB for a cone)
- Severity: polish        Milestone: OR3
- Tried: the recipe with `"defaults": { "texSize": 1024 }` (PNG by default).
- Wanted: small prop files; a cone or barrel is a few hundred triangles on flat colour swatches.
- Got: each GLB embeds its pack's full 1024 px PNG atlas: 17 models = 19.6 MB (barrel 590 KB, cone 770 KB,
  truck 2.6 MB). Every prop from the same pack carries its own copy of the same atlas.
- Workaround: `ssg.models.json` sets `"defaults": { "texSize": 256, "texFormat": "webp" }` and 1024 px only on the
  trucks: 13 models = 5.7 MB (cone 36 KB, truck 1.37 MB), no visible difference at the race camera.
- Suggested change: default to WebP, or pick the texture size by kind (props 256–512); optionally let `apply` write a
  pack's atlas once as a shared external texture that several GLBs reference.
- Status: triaged (TODO: OR-FB-004)

## OR-FB-005 · Billboards export without their sign art
- Severity: workaround        Milestone: OR3
- Tried: `POLYGON_Palm_City/SM_Prop_Billboard_02` (256 and 1024 px), and `POLYGON_City/SM_Prop_Billboard_01` with
  `attach: ["205"]` (`SM_Prop_Billboard_Sign_01`).
- Wanted: a trackside billboard with its advert, for stadium dressing.
- Got: the Palm City billboard's face shows the whole PolygonPalmCity_01_B/C atlas (rows of swatches and tiny
  decals) instead of one advert; the City frame + sign shows a dark grey panel with atlas fragments. It looks like
  the sign meshes use a dedicated sign texture or a UV sub-rect the export does not carry.
- Workaround: no billboards (`track/props-view.ts` comment); floodlight trailers dress the back wall instead.
- Suggested change: bind sign/billboard materials to their own textures (or expose the texture choice in the spec,
  e.g. `textures: { slot: "Billboard_03" }`), and let `model info` show the materials and textures an export uses.
- Status: triaged (TODO: OR-FB-005)

## OR-FB-006 · Four tints of one truck are four full copies of its geometry
- Severity: polish        Milestone: OR3
- Tried: `truck_red/blue/yellow/grey`, the same asset + attach with different `tint`.
- Wanted: one geometry download and a tinted texture (or material variant) per colour.
- Got: four 1.37 MB GLBs (0.66 MB gzipped each), identical except the texture: 5.5 MB of the 5.9 MB model folder.
- Workaround: none (the game loads all four).
- Suggested change: `tints: { red: "#c62828", … }` on one spec, written as one GLB with KHR_materials_variants, or
  a texture-only output per tint; separately, an option for meshopt/quantised geometry.
- Status: triaged (TODO: OR-FB-006)

## OR-FB-007 · Prop search gives no hint that a hit is a modular piece or oddly scaled
- Severity: polish        Milestone: OR3
- Tried: `ssg assets floodlight|"stadium light"|"light pole" --kind prop`, then `ssg model info` on the hits.
- Wanted: a tall stadium light mast for the arena corners.
- Got: most hits are parts or doll-sized: `POLYGON_City/SM_Prop_LightPole_CrossLights_01` 0.46 × 0.40 m,
  `POLYGON_Gang_Warfare/SM_Prop_Light_Portable_Lights_01` 0.60 × 0.18 m, `POLYGON_Apocalypse/SM_Prop_Floodlights_02`
  0.20 × 0.45 m. `POLYGON_BattleRoyale/SM_Prop_Spotlight_01` is a 6.4 m pole whose head leaves the frame. Only
  `model info` (one call per hit) reveals the sizes; the search table has no size column and no "part of a modular
  set" flag.
- Workaround: `POLYGON_Apocalypse/SM_Prop_Floodlights_01` (a light-mast trailer, 3.5 × 3.9 m) as the floodlight.
- Suggested change: a size column (metres) in `ssg assets` / `search_assets`, and a modular-piece flag or a link to
  the assembled prefab when the pack has one.
- Status: triaged (TODO: OR-FB-007)
