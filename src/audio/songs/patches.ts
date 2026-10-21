// Instrument patches for the songs: 2-operator FM, voiced like an OPL2 bank.
import type { Patch } from '../fm';

/** Bright twangy lead: half-sine modulator at 1:1, index settling down. */
export const twang: Patch = { car: 'sine', mod: 'half', ratio: 1, index: 3.2, indexEnd: 0.45, indexTime: 0.25, a: 0.004, d: 0.3, s: 0.55, r: 0.12, gain: 0.16, vib: [5.5, 18] };
/** Brass: the index swells with the note. */
export const brass: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 2.6, indexAttack: 0.07, indexEnd: 0.8, indexTime: 0.3, a: 0.03, d: 0.25, s: 0.8, r: 0.12, gain: 0.13, vib: [5, 12] };
/** Plucked electric bass. */
export const bass: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 1.9, indexEnd: 0.3, indexTime: 0.18, a: 0.003, d: 0.35, s: 0.45, r: 0.06, gain: 0.32, gate: 0.85 };
/** Banjo-ish pluck: 3:1 modulator, fast decay, no sustain. */
export const pluck: Patch = { car: 'sine', mod: 'sine', ratio: 3, index: 3.5, indexEnd: 0.1, indexTime: 0.12, a: 0.002, d: 0.28, s: 0, r: 0.08, gain: 0.11 };
/** Palm-muted rhythm guitar chug: abs-sine carrier, very bright, short. */
export const chug: Patch = { car: 'abs', mod: 'sine', ratio: 1, index: 4, indexEnd: 0.3, indexTime: 0.08, a: 0.002, d: 0.1, s: 0.25, r: 0.05, gain: 0.06, lp: 2600, gate: 0.7 };
/** Soft organ pad: 2:1, steady index, slow attack. */
export const organ: Patch = { car: 'sine', mod: 'sine', ratio: 2, index: 0.9, a: 0.08, d: 0.4, s: 0.8, r: 0.3, gain: 0.045 };
/** Electric piano: 1:1 with a quick bright tine at the start. */
export const epiano: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 1.6, indexEnd: 0.25, indexTime: 0.35, a: 0.003, d: 0.8, s: 0.25, r: 0.25, gain: 0.07 };
/** Harmonica-ish reed lead: quarter-sine modulator, wide vibrato, breathy attack. */
export const reed: Patch = { car: 'sine', mod: 'quarter', ratio: 1, index: 1.7, indexAttack: 0.05, a: 0.03, d: 0.2, s: 0.75, r: 0.1, gain: 0.13, vib: [6, 25] };
