/**
 * The note insert mode is about to place, shown as a ghost at the cursor until it's placed.
 * It starts as a copy of the selected note and is adjusted key by key.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorPitch, voiceLeaves } from '../cursor/Cursor';
import { Duration } from '../duration/Duration';
import { KeySignature, scaleStep } from '../key/KeySignature';
import { Clef } from '../part/Part';

export interface Phantom {
    pitch: number;
    duration: Duration;
    staccato: boolean;
}

/** Where a phantom starts when the cursor is on a rest: the middle line of the stave */
const MIDDLE_LINE_PITCH: Record<Clef, number> = { treble: 71, bass: 50 };

const QUARTER: Duration = { base: 4, dots: 0 };
const BASES: Duration['base'][] = [64, 32, 16, 8, 4, 2, 1];
const LOWEST_PITCH = 0;
const HIGHEST_PITCH = 127;

/** A phantom copying the pitch and written duration of the cursor's note */
export function phantomAt(composition: Composition, cursor: Cursor): Phantom {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    const clef = composition.parts[cursor.part]?.clef ?? 'treble';
    return {
        pitch: cursorPitch(composition, cursor) ?? MIDDLE_LINE_PITCH[clef],
        duration: event?.duration ?? QUARTER,
        staccato: false,
    };
}

/** Raises (positive) or lowers it by half steps, stopping at the ends of MIDI's range */
export function shiftPitch(phantom: Phantom, semitones: number): Phantom {
    const pitch = Math.max(LOWEST_PITCH, Math.min(HIGHEST_PITCH, phantom.pitch + semitones));
    return { ...phantom, pitch };
}

/** Steps through note values, keeping dots: positive goes longer (quarter to half) */
/** Steps to the next note of the key's scale: positive goes up */
export function stepScale(phantom: Phantom, key: KeySignature, steps: number): Phantom {
    return { ...phantom, pitch: scaleStep(phantom.pitch, key, steps) };
}

export function stepDuration(phantom: Phantom, steps: number): Phantom {
    const index = BASES.indexOf(phantom.duration.base);
    const base = BASES[Math.max(0, Math.min(BASES.length - 1, index + steps))]!;
    return { ...phantom, duration: { ...phantom.duration, base } };
}

export function toggleDot(phantom: Phantom): Phantom {
    return { ...phantom, duration: { ...phantom.duration, dots: phantom.duration.dots ? 0 : 1 } };
}

export function toggleStaccato(phantom: Phantom): Phantom {
    return { ...phantom, staccato: !phantom.staccato };
}
