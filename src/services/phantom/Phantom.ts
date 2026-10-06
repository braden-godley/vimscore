/**
 * The note insert mode is about to place, shown as a ghost at the cursor until it's placed.
 * It starts as a copy of the selected note and is adjusted key by key.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorPitch, voiceLeaves } from '../cursor/Cursor';
import { Duration } from '../duration/Duration';
import { KeySignature } from '../key/KeySignature';
import { Articulation, withArticulation, withoutArticulations } from '../note/Note';
import { Clef } from '../part/Part';
import { HIGHEST_MIDI, LOWEST_MIDI, Pitch, midi, pitch, scaleStep, transpose } from '../pitch/Pitch';

/** Its articulations are what the note it places gets */
export interface Phantom extends Partial<Record<Articulation, boolean>> {
    pitch: Pitch;
    duration: Duration;
}

/** Where a phantom starts when the cursor is on a rest: the middle line of the stave */
const MIDDLE_LINE_PITCH: Record<Clef, Pitch> = { treble: pitch('B4'), bass: pitch('D3') };

const QUARTER: Duration = { base: 4, dots: 0 };
const BASES: Duration['base'][] = [64, 32, 16, 8, 4, 2, 1];

/** A phantom copying the pitch and written duration of the cursor's note */
export function phantomAt(composition: Composition, cursor: Cursor): Phantom {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    const clef = composition.parts[cursor.part]?.clef ?? 'treble';
    return {
        pitch: cursorPitch(composition, cursor) ?? MIDDLE_LINE_PITCH[clef],
        duration: event?.duration ?? QUARTER,
    };
}

/**
 * Raises (positive) or lowers it by half steps, stopping at the ends of MIDI's range. A black
 * key is spelled the way it moved: a sharp going up, a flat going down.
 */
export function shiftPitch(phantom: Phantom, semitones: number): Phantom {
    const from = midi(phantom.pitch);
    const to = Math.max(LOWEST_MIDI, Math.min(HIGHEST_MIDI, from + semitones));
    return { ...phantom, pitch: transpose(phantom.pitch, to - from) ?? phantom.pitch };
}

/** Steps through note values, keeping dots: positive goes longer (quarter to half) */
/** Steps to the next note of the key's scale: positive goes up */
export function stepScale(phantom: Phantom, key: KeySignature, steps: number): Phantom {
    return { ...phantom, pitch: scaleStep(phantom.pitch, key, steps) };
}

/** A new value starts plain: no dot and no articulation */
export function setDuration(phantom: Phantom, base: Duration['base']): Phantom {
    return { ...withoutArticulations(phantom), duration: { base, dots: 0 } };
}

export function stepDuration(phantom: Phantom, steps: number): Phantom {
    const index = BASES.indexOf(phantom.duration.base);
    return setDuration(phantom, BASES[Math.max(0, Math.min(BASES.length - 1, index + steps))]!);
}

export function toggleDot(phantom: Phantom): Phantom {
    return { ...phantom, duration: { ...phantom.duration, dots: phantom.duration.dots ? 0 : 1 } };
}

/** Puts an articulation on or takes it off; an accent and a marcato replace each other */
export function toggleArticulation(phantom: Phantom, articulation: Articulation): Phantom {
    return withArticulation(phantom, articulation, !phantom[articulation]);
}
