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
- Status: verified (exporter v6, 2026-10-21). `ssg model --help`, `model preview --help` and the other subcommands list
  `--json` under "Global Options"; `scripts/build-assets.mjs` reads the documented `{ dir, index, models, removed }`.

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
- Status: verified (exporter v6, 2026-10-21). Atlases are cropped to their UVs and webp by default: re-exporting the same
  21 specs went from 9.63 MB to 8.63 MB of GLBs (cone 36 → 19 KB, barrel 35 → 23 KB, floodlight 200 → 195 KB). The
  game keeps `"defaults": { "texSize": 256 }` so its characters stay small; the props would get 256 px by kind anyway.

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
- Status: verified (2026-10-21, after the City/Palm City re-ingest). `ssg model preview` of Palm City
  `SM_Prop_Billboard_01` / `_02` and City `SM_Prop_Billboard_01` + `SM_Prop_Billboard_Sign_01..07` at `texSize: 1024`
  shows each advert (Welcome to Palm City, Palms Estate / Bad Tooth, City Life, Hot Pizza, Tropical Holiday, Donuts,
  Casino, Big Burgers, Polygonda). Four City billboards (`billboard_pizza/burgers/holiday/donuts`) now stand between the
  floodlights on the back wall (`track/props-view.ts`), and the art reads from the race camera.

## OR-FB-006 · Four tints of one truck are four full copies of its geometry
- Severity: polish        Milestone: OR3
- Tried: `truck_red/blue/yellow/grey`, the same asset + attach with different `tint`.
- Wanted: one geometry download and a tinted texture (or material variant) per colour.
- Got: four 1.37 MB GLBs (0.66 MB gzipped each), identical except the texture: 5.5 MB of the 5.9 MB model folder.
- Workaround: none (the game loads all four).
- Suggested change: `tints: { red: "#c62828", … }` on one spec, written as one GLB with KHR_materials_variants, or
  a texture-only output per tint; separately, an option for meshopt/quantised geometry.
- Status: verified (exporter v6, 2026-10-21). One `truck` spec with `variants` (red/blue/yellow/grey) and
  `compress: "meshopt"`: one 585 KB GLB (441 KB gzipped) replaces 4 × 1.37 MB. `race/models.ts` loads it with the
  MeshoptDecoder and gives each colour a scene clone with its variant's materials (`withVariant`, the
  parser.associations recipe in docs/MODELS.md). `ssg model preview --variant blue` etc. show each colour; the race
  grid and the podium show four colours. All models: 8.63 MB → 4.37 MB, with 4 billboards and 3 crowd pose sets added.

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
- Status: verified (2026-10-21). `ssg assets billboard --kind prop` has a `size m` column, and `--min-size`, `--max-size`,
  `--no-modular` filter by it (`ssg assets "stadium light" --kind prop --min-size 5 --no-modular`). The size column
  alone picked the billboards without a `model info` per hit. Small gap: `--no-modular` still lists City
  `SM_Prop_Billboard_Sign_0N`, which are the sign panels of `SM_Prop_Billboard_01` (OR-FB-015).

## OR-FB-008 · `ssg model preview` fails when the web dev server is down, though the API serves the page itself
- Severity: workaround        Milestone: OR4
- Tried: `ssg model preview POLYGON_BattleRoyale/Character_RedneckMale_01 --frames 4 --size 200 --out x.png` (and
  three more characters), 2026-10-21, API on 5181.
- Wanted: a contact sheet of each driver candidate before exporting it.
- Got: `ssg: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5180/model-preview.html` and the raw
  Playwright call log, every time. `/api/health` says `webUrl: http://localhost:5180` (nothing listening) and
  `servesWeb: true`, and `http://localhost:5181/model-preview.html` answers 200: the page was there all along.
- Workaround: the game's own `?scene=podium` debug scene became the preview: the drivers were judged from its
  screenshots (and a frame-by-frame capture of the clips through `window.__or.podium().tick(dt)`).
- Suggested change: when the server serves the web build itself, open the preview page from its own origin (or
  fall back to it when `SSG_WEB_URL` does not answer), and turn a connection error into one line that names the URL
  and the setting.
- Status: verified (2026-10-21). With nothing on 5180 (`/api/health` still says `webUrl: http://localhost:5180`), `ssg
  model preview` renders through the API's own page: every new model in this pass was previewed first (the variant
  truck in four colours, the crowd poses, seven billboards), 3–5 s each.

## OR-FB-009 · No clap, cheer, celebrate, defeat or seated clips
- Severity: workaround        Milestone: OR4
- Tried: `ssg animations victory|cheer|clap|celebrate|defeat|sad|sit|seat|drive|driving|chair`.
- Wanted: a podium (winner celebrates, 2nd and 3rd clap, 4th dejected), a cheering crowd, and later a driver seated
  in the cab and a seated crowd on the benches.
- Got: `MartialArts_Victory` (an upload) is the only victory clip; nothing for clap, cheer, celebrate, defeat, sad,
  sit, seat or drive (`sit` only finds `Crouch_ToStand`). The Idles pack's waves stand in.
- Workaround: winner `MartialArts_Victory` then `POLY_IDL_Wave_Double_Loop` (both arms up, with the trophy), 2nd
  `POLY_IDL_Wave_Large_Loop`, 3rd `POLY_IDL_Wave_Small_Loop` (waves instead of claps), 4th
  `POLY_IDL_Posture_Slumped_Loop`; the crowd cheers with the two-arm and large waves and stands instead of sitting
  (`ssg.models.json`, `race/characters.ts` CLIPS). No driver is drawn in the cabs.
- Suggested change: an animation pack (or Mixamo uploads) with clap, cheer/fist-pump, dejected, a seated idle and a
  seated driving pose; and synonyms in the clip search (cheer → wave/victory, sad → slumped/disappointed).
- Status: verified (2026-10-21, with ANIMATION_Emotes_And_Taunts and the Mixamo uploads in `_Uploads`). Podium: winner
  `POLY_EMOT_Celebrate_BeatChest` then `Driver_Trophy` (both arms overhead with the cup), 2nd
  `POLY_EMOT_Celebrate_Clapping_Polite`, 3rd `POLY_EMOT_Happy_FistPump`, 4th `Driver_Defeated`. Crowd: seated
  `Crowd_Sit_Idle` / `Crowd_Sit_Cheer`, standing up with `POLY_EMOT_Happy_ArmsRaised` / `Happy_FistPump`; the flagman
  plays `Flagman_Wave`. All qualified by gender where Synty has two, no manifest warnings. Not used: `Driver_Drive`
  (no drivers are drawn in the cabs: at the race camera a cab is a few pixels). The search synonyms part (cheer →
  wave) is moot now that the clips exist.

## OR-FB-010 · A clip name is ambiguous: Masculine and Feminine (and Polygon/Sidekick) variants share it
- Severity: polish        Milestone: OR4
- Tried: `"clips": ["POLY_IDL_Wave_Large_Loop", …]` on a male (`SK_Character_Biker`) and a female
  (`SK_Chr_Mechanic_Female_01`) driver.
- Wanted: the feminine variant on the female mechanic, or at least to know which one was merged.
- Got: `ssg animations wave` lists `POLY_IDL_Wave_Large_Loop` twice (ids 491/656 Feminine/Masculine on Sidekick,
  and again on Polygon). The spec takes only a name, `model info` lists each name once in `clipsAvailable`, and the
  manifest's `clips` entry says nothing about which variant (gender, rig, id) it is.
- Workaround: none (both look acceptable at podium size).
- Suggested change: pick the variant that matches the character's gender by default, accept an id or a qualifier
  (`POLY_IDL_Wave_Large_Loop@Feminine`), and put `{ id, gender, rig, pack }` in the manifest's clip entry.
- Status: verified (exporter v6, 2026-10-21). Without qualifiers every character export warned `clip POLY_IDL_Base: 2
  clips match; used POLY_IDL_Base@Masculine (#174, ANIMATION_Idles)…` (it already picked the character's gender). The
  specs now say `POLY_IDL_…@Masculine` / `@Feminine` per character; the manifests carry `source: { id, pack, name,
  variant, set }`, the GLB keeps the qualified name (`race/characters.ts findClip` matches the base name) and
  `manifest.warnings` is absent on all 25 models.

## OR-FB-011 · `simplify` does nothing on a skinned character (and says nothing)
- Severity: polish        Milestone: OR4
- Tried: `"simplify": 0.5` on the three crowd fans (`SK_Character_SummerGirl`, `_Jock`, `_HipsterGuy`).
- Wanted: half the triangles for 44 fans in the grandstand.
- Got: 2304 → 2274, 1814 → 1794, 2636 → 2612 triangles; new export ids, no `warnings`.
- Workaround: the fans stay at full detail (the crowd is ~98k triangles per pass); the spec does not set `simplify`.
- Suggested change: simplify skinned meshes too (keeping the skin weights), or say in `warnings` that it was skipped.
- Status: verified (exporter v6, 2026-10-21). `simplify: 0.5` on the fans (skinned `fan_a/b/c` and the `crowd_a/b/c`
  poses): the 44-fan crowd went from ~98k to 49.5k triangles per pass, the skinned fans still animate, and the
  faceted look holds in a close-up of the stand (docs/screenshots/crowd.png).

## OR-FB-012 · Crowds need static posed meshes; the game skins them on the CPU itself
- Severity: workaround        Milestone: OR4
- Tried: a grandstand of ~44 Synty fans: 44 skinned characters would be 44 skeletons, 44 mixers and 44 draw calls.
- Wanted: an export of a character frozen in a clip's pose, as a plain (unskinned) mesh, ready for an
  InstancedMesh: e.g. spec `pose: { clip: "POLY_IDL_Wave_Double_Loop", time: 0.12 }` or `--pose clip@t`, ideally
  several poses in one GLB as separate meshes.
- Got: only skinned exports.
- Workaround: `race/characters.ts bakePose()` loads the skinned GLB, poses it with an AnimationMixer and applies
  the bone transforms to every vertex once (tagged `// OR-FB-012`); `race/crowd.ts` draws one InstancedMesh per fan
  model per pose (idle, two cheer frames) plus 6 skinned fans.
- Suggested change: the `pose` spec field above; and character manifests could carry a posed bound too (the
  `bounds` are the T-pose: 2.05 × 1.86 × 0.37 m for a person, which is no use for spacing a crowd).
- Status: verified (exporter v6, 2026-10-21). `crowd_a/b/c` are `poses` exports (`idle` POLY_IDL_Base 0.6 s, `cheer_a`/`cheer_b`
  POLY_IDL_Wave_Double_Loop 0.12 / 0.5 s), a node per pose; `race/crowd.ts` instances their meshes directly and
  `bakePose()` is gone. The manifests' `bounds` are now posed (1.07 × 2.15 × 0.48 m with the arms up, 0.78 m wide at
  idle, against the 2.05 m T-pose before). 6 skinned fans stay for life in the front rows.

## OR-FB-013 · No 3D trophy: the trophy props are flat icons
- Severity: polish        Milestone: OR4
- Tried: `ssg assets trophy|cup|award|goblet|chalice|medal|prize`.
- Wanted: a winner's cup for the podium.
- Got: `POLYGON_Icons/SM_Icon_Trophy_01..04`, 0.34 × 0.40 × 0.08 m: flat, 8 cm deep icon shapes; otherwise drinking
  cups and fantasy goblets.
- Workaround: `SM_Icon_Trophy_01` at 1.7× in the winner's right hand (`ui/podium-view.ts`); from the podium camera
  the flatness does not show.
- Suggested change: a pack gap note (a sports/stadium pack with trophies); `ssg assets` could tag icon-pack props
  as `icon` so a search can tell them from full props.
- Status: verified (2026-10-21, POLYGON_Pro_Racer installed). `SM_Prop_Trophy_01` is a full two-handled cup (0.53 ×
  0.84 × 0.27 m); the winner lifts it at 0.95× (`ui/podium-view.ts`, model `trophy`), and the icon is gone.

## OR-FB-014 · Previewing a `poses` export draws every pose on top of each other
- Severity: polish        Milestone: OR4
- Tried: `ssg model preview --spec crowd_a.json --out x.png` with a three-pose spec (idle, two cheer frames), then
  `--pose cheer_a` (`error: unknown option '--pose'`) and `--variant cheer_a` (no variant).
- Wanted: to look at each baked pose before using it, as `--variant` does for paint variants.
- Got: one figure with all three poses overlaid (arms down and arms up at once), headed by the bounds of the
  union. `preview` also has no `--pose`, `--poses`, `--simplify`, `--fit-*` or `--tex` flags (export has them), so
  those only work through `--spec`.
- Workaround: one throwaway single-`pose` spec per frame, previewed one by one (same export settings, different ids).
- Suggested change: `--pose <name>` on preview for a `poses` export (or a contact sheet with one column per pose),
  and the export flags on preview too.
- Status: fixed (generator wave-16 68a3d3f)

## OR-FB-015 · `ssg assets --no-modular` lists the City billboard's sign panels
- Severity: polish        Milestone: OR4
- Tried: `ssg assets billboard --kind prop --no-modular`.
- Wanted: whole models only.
- Got: City `SM_Prop_Billboard_Sign_01..07` (4.2 × 2.03 × 0.12 m) and Apocalypse `SM_Prop_Billboard_Sign_0N`
  are listed; they are the advert panels that docs/MODELS.md says to `attach` to `SM_Prop_Billboard_01` (the frame
  alone has no sign).
- Workaround: none needed (the docs say how to pair them).
- Suggested change: flag sign panels as modular / attachment pieces, or have the search row for the frame say
  `attach: SM_Prop_Billboard_Sign_01..07`.
- Status: fixed (generator wave-16 68a3d3f)

## OR-FB-016 · Pro Racer characters export with the vehicle atlas: white skin, white hair
- Severity: blocks (Pro Racer characters)        Milestone: OR5
- Tried: `ssg model preview POLYGON_Pro_Racer/SM_Chr_Crowd_01 --poses …` and the same for `SM_Chr_Crowd_02..04`,
  `SM_Chr_Driver_Male_01/02`, `SM_Chr_Driver_Female_01/02`, `SM_Chr_PitCrew_01/02`, `SM_Chr_Announcer_01/02`; then
  `ssg model export SM_Chr_Crowd_01 --attach SM_Chr_Attach_Hair_08 --pose …` and read the GLB.
- Wanted: the racing-suit drivers for the podium (four suit colours with `variants`) and the Pro Racer crowd.
- Got: every one has a white face and hands, white hair and pale blue facial hair; the clothes happen to land on
  plausible swatches. The GLB has one material, `PolygonProRacer_VehicleTexture_01.png`, with the vehicle atlas
  embedded: the characters are bound to the pack's vehicle texture instead of its character texture, so skin and hair
  sample white swatches. No warning.
- Workaround: none; the podium keeps the City / BattleRoyale / Apocalypse drivers and the crowd uses City Characters
  (`ssg.models.json`). `--variants` on `SM_Chr_Driver_Male_01` does recolour the suit's magenta panels (the paint
  detection works), so they would make good drivers once the texture is right.
- Suggested change: bind Pro Racer `SM_Chr_*` to the character texture its MaterialList names (re-ingest), and warn
  when a character's texture is a vehicle/environment atlas.
- Status: open

## OR-FB-017 · Pro Racer helmets attach at the character's feet
- Severity: workaround        Milestone: OR5
- Tried: `ssg model preview POLYGON_Pro_Racer/SM_Chr_Driver_Male_01 --attach SM_Chr_Attach_Helmet_01..04 --pose
  POLY_EMOT_Happy_ArmsRaised@Masculine:0.6` (a helmet would also have hidden OR-FB-016's white head).
- Wanted: the helmet on the head (bound to the head bone like the hair attachments).
- Got: the helmet stands on the ground between the feet in every pose; the hair attachments (`SM_Chr_Attach_Hair_08`)
  do sit on the head. `ssg model info` lists the helmets as `attachment` assets but not in the drivers'
  `attachAvailable`, so they are separate static models placed at their authored origin (0, 0, 0).
- Workaround: no helmets.
- Suggested change: attach a static head-wear model to the head bone (by its kind or name), or take a `socket` in the
  attach entry: `attach: [{ asset: "SM_Chr_Attach_Helmet_01", socket: "head" }]`.
- Status: open

## OR-FB-018 · Cut-out foliage exports opaque: cactus, succulent and tumbleweed cards show black boxes
- Severity: workaround        Milestone: OR5
- Tried: `ssg model preview POLYGON_NatureBiomes_AridDesert/SM_Env_Cactus_01..03`, `SM_Env_Succulent_04/06`,
  `SM_Prop_Tumbleweed_01`, `SM_Env_Bush_Bramble_01`, `SM_Env_GroundCover_02`; exported `SM_Env_Cactus_03` and read
  the GLB.
- Wanted: the plants cut out of their textures.
- Got: black (or dark) rectangles around every leaf card. The textures do carry alpha (webp RGBA, alpha 0..255), but
  the materials have no `alphaMode` (glTF default OPAQUE); `doubleSided` is set.
- Workaround: `track/stadium-view.ts` sets `alphaTest = 0.5` on the plant and tumbleweed materials (tagged
  `// OR-FB-018`).
- Suggested change: write `alphaMode: "MASK"` (with `alphaCutoff`) for materials whose Synty shader is a cut-out
  (foliage / `_Leaf` / alpha-clip) or whose texture has a used alpha channel; previews would then show it too.
- Status: open

## OR-FB-019 · FX meshes lose their FX material: the flame is grey, the crowd cards are white
- Severity: workaround        Milestone: OR5
- Tried: `ssg model preview POLYGON_Pro_Racer/SM_Flame_Mesh_01`, `SM_FX_Crowd_Group_01`, `SM_FX_Crowd_Single_01`.
- Wanted: the flame-booster mesh for the nitro burst, and the crowd cards as cheap fill for the stands.
- Got: the flame is a plain grey cone; the crowd groups and singles are white quads (no texture). Their Synty FX
  shaders (additive / alpha-blended, with their own textures) are not carried over.
- Workaround: `race/truck-view.ts` takes only the flame's geometry and draws it with additive orange and white-hot
  materials of its own (tagged `// OR-FB-019`); the crowd cards are not used (the stands get baked-pose fans).
- Suggested change: map FX materials to an emissive or additive-looking glTF material with their texture (and alpha
  BLEND), and flag `kind: fx` exports with a warning when the look depends on a shader.
- Status: open

## OR-FB-020 · No confetti (or any particle effect) to export
- Severity: workaround        Milestone: OR5
- Tried: `ssg assets confetti`, `ssg assets --pack POLYGON_Pro_Racer --kind fx` (both modular and whole).
- Wanted: Pro Racer's "confetti" and "bottle spray" FX on the podium (the store page lists them).
- Got: no confetti, spray, dust or smoke assets: the pack's FX are Unity particle systems, which the library does not
  ingest; only FX meshes (flame, checkpoint, light rays, crowd cards) are there.
- Workaround: `ui/podium-view.ts` draws its own confetti (260 instanced paper squares, tagged `// OR-FB-020`).
- Suggested change: a pack-gap note in `ssg assets` for particle-only FX, or an export of a particle system's
  settings (texture, colours, rate, lifetime) for games to rebuild.
- Status: open

## OR-FB-021 · Previews showed Mixamo one-shot clips with frozen arms
- Severity: polish        Milestone: OR5
- Tried: `ssg model preview POLYGON_City_Characters/SK_Character_Jock --clip Crowd_Sit_Clap|Driver_Trophy|Driver_Clap
  --frames 8`.
- Wanted: the arm motion across the clip.
- Got: the arms stayed put in every frame (clap hands still, the trophy lift never lifting), while `Crowd_Sit_Cheer`,
  `Driver_Victory` and `Driver_Defeated` moved. The orchestrator traced it to the preview renderer (a LoopOnce +
  clampWhenFinished action pauses past its end and `setTime` never un-pauses it). In the game, `Driver_Trophy`
  plays correctly through `mixer.update` (podium frame captures at 1, 3.5, 5 and 7 s).
- Workaround: none needed in the game. While the preview was being fixed, `ssg model preview` failed for a while with
  "the model preview page did not load from http://127.0.0.1:5181/model-preview.html".
- Suggested change: re-test the clip strip with a one-shot clip in the preview's own checks.
- Status: fixed (generator, reported by the orchestrator 2026-10-21)

## OR-FB-022 · A traffic light has no lamp parts to light
- Severity: workaround        Milestone: OR5
- Tried: `ssg model info POLYGON_Pro_Racer/SM_Prop_Trafficlight_01` (`parts: []`), `ssg parts … ` ("no animatable
  parts"), and the exported GLB (one mesh, one atlas material).
- Wanted: to light the three lamps from the race's countdown (red, red, red, green).
- Got: the lamps are painted swatches on the atlas inside one mesh, so there is nothing to switch or make emissive.
- Workaround: `track/stadium-view.ts` puts three emissive-looking discs (MeshBasicMaterial) over the lamp faces and
  lights those (tagged `// OR-FB-022`).
- Suggested change: split lamp/glass sub-meshes by material or swatch into named parts (role `light`, with a
  `lights: [{ node, colour }]` block in the manifest), or an option to put given swatches on their own emissive
  material.
- Status: open

## OR-FB-023 · Small export oddities in Pro Racer: Seating_05's texture, the pit box's "wheels"
- Severity: polish        Milestone: OR5
- Tried: `ssg model preview POLYGON_Pro_Racer/SM_Bld_Grandstand_Seating_05`; `ssg model apply` with
  `SM_Prop_Pit_Box_02`.
- Got: Seating_05 shows magenta/green noise across its seats (Seating_01..03 look right, so it looks like the wrong
  texture or UV set); the pit box (a tool trolley) gets `warnings: ["2 wheels could not be mapped to front/rear
  left/right"]`, since it has two castors and is not a vehicle.
- Workaround: Seating_01 on the grandstands; the pit box warning is harmless.
- Suggested change: check Seating_05's material slots; skip the wheels block (and its warning) for props that are
  not vehicles.
- Status: open

## OR-FB-024 · Stand models carry no seat points; the game finds the seats by ray casting
- Severity: workaround        Milestone: OR5
- Tried: `ssg model info` on `SM_Bld_Grandstand_01` (+ `SM_Bld_Grandstand_Seating_01`), `SM_Bld_Grandstand_VIP_01`
  and `SM_Prop_Bleachers_01`; the manifests (parts, sockets) after the export.
- Wanted: where to seat a crowd: seat rows (positions, facing, pitch) in the manifest, like `sockets`.
- Got: no parts or sockets for seats.
- Workaround: `track/stadium-view.ts findSeats()` casts rays down through each stand model to find the treads and seat
  pans, then a seat every 0.62 m where a ray finds one (aisles have none): 160 seats on a grandstand, 32 on the VIP
  box, 64 on the bleachers (tagged `OR-FB-024`).
- Suggested change: a `seats: [{ pos, yaw }]` block for seating props (benches, bleachers, grandstands, sofas), found
  the same way at export.
- Status: open
