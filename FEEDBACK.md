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
