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
- Status: open

## OR-FB-002 · No target size for a model export (the game rescales the GLB to its physics)
- Severity: workaround        Milestone: OR2
- Tried: the spec in the generator's docs/MODELS.md (branch integrate-w16): `asset, name, clips, inPlace, attach,
  origin, texSize, texFormat, simplify, tint`.
- Wanted: a way to ask for the truck at the game's size, e.g. `"fit": { "length": 4.75 }` (or `"scale": 0.92`), so
  the GLB, its manifest `bounds`/`wheels.radius`/`collider.box` and the game's 4.5 m physics chassis agree without
  game code doing maths on the manifest. The track scale (truck ≈ 1/19 of the arena width) is fixed by the
  original's proportions, so the truck size is a design input, not whatever the Synty pickup measures.
- Got: the export is always in the model's own metres.
- Workaround: `src/race/truck-view.ts` scales the loaded GLB by `4.5 × 1.06 / bounds.size[2]` and divides wheel
  suspension offsets by that scale (tagged `// OR-FB-002`).
- Suggested change: a `fit` (or `scale`) spec field / `--fit-length` flag, applied before the manifest numbers are
  computed (so wheel radius, pivots and the collider box come out scaled too).
- Status: open
