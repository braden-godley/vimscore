/**
 * The note insert mode is about to place, shown as a ghost at the cursor until it's placed.
 * It starts as a copy of the selected note and is adjusted key by key.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorPitch, voiceLeaves } from '../cursor/Cursor';
import { resolveMeasures } from '../measure/Measure';
import { Duration } from '../duration/Duration';
import { C_MAJOR, KeySignature } from '../key/KeySignature';
import { Articulation, withArticulation, withoutArticulations } from '../note/Note';
import { MIDDLE_LINE_PITCH, clefAt } from '../clef/Clef';
import { SNARE, stepKit, stepSounds } from '../instrument/Drums';
import { HIGHEST_MIDI, LETTERS, LOWEST_MIDI, Pitch, comparePitch, keyAlter, midi, scaleStep, transpose } from '../pitch/Pitch';

/** Its articulations are what the note it places gets */
export interface Phantom extends Partial<Record<Articulation, boolean>> {
    pitch: Pitch;
    duration: Duration;
}

const QUARTER: Duration = { base: 4, dots: 0 };
const BASES: Duration['base'][] = [64, 32, 16, 8, 4, 2, 1];

/** A phantom copying the pitch and written duration of the cursor's note */
export function phantomAt(composition: Composition, cursor: Cursor): Phantom {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    return {
        pitch: cursorPitch(composition, cursor) ?? restPitch(composition, cursor),
        duration: event?.duration ?? QUARTER,
    };
}

/**
 * On a rest it starts on the top note of the last chord before it in the voice, across
 * barlines. Before any, it starts on the key's root nearest the middle line of the stave, or
 * on the snare for drums.
 */
function restPitch(composition: Composition, cursor: Cursor): Pitch {
    const previous = previousChord(composition, cursor);
    if (previous) return previous;
    const part = composition.parts[cursor.part];
    const clef = part ? clefAt(part, cursor.measure) : 'treble';
    if (clef === 'percussion') return SNARE;
    const key = resolveMeasures(composition.measures)[cursor.measure]?.keySignature ?? C_MAJOR;
    return rootNear(key, MIDDLE_LINE_PITCH[clef]);
}

function previousChord(composition: Composition, cursor: Cursor): Pitch | undefined {
    for (let measure = cursor.measure; measure >= 0; measure--) {
        const leafList = voiceLeaves(composition, cursor.part, measure, cursor.voice);
        const end = measure === cursor.measure ? cursor.leaf : leafList.length;
        for (let leaf = end - 1; leaf >= 0; leaf--) {
            const event = leafList[leaf]!.event;
            if (event.kind === 'chord' && event.notes.length > 0) {
                return event.notes.map((note) => note.pitch).reduce((a, b) => (comparePitch(a, b) >= 0 ? a : b));
            }
        }
    }
    return undefined;
}

/** The major key's root in the octave closest to `near`; the higher one on a tie */
function rootNear(key: KeySignature, near: Pitch): Pitch {
    // Each sharp moves the root up a fifth, four letters on; each flat down one
    const letter = LETTERS[(((key.fifths * 4) % 7) + 7) % 7]!;
    const alter = keyAlter(letter, key);
    const target = midi(near);
    let best: Pitch = { letter, alter, octave: near.octave };
    for (const octave of [near.octave - 1, near.octave + 1]) {
        const candidate = { letter, alter, octave };
        const distance = Math.abs(midi(candidate) - target) - Math.abs(midi(best) - target);
        if (distance < 0 || (distance === 0 && midi(candidate) > midi(best))) best = candidate;
    }
    return best;
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

/** Steps to the next drum of the kit as it's written on a percussion staff: positive goes up */
export function stepDrums(phantom: Phantom, steps: number): Phantom {
    return { ...phantom, pitch: stepKit(phantom.pitch, steps) };
}

/**
 * Steps through every sound as it's written on a percussion staff, the kit and the sounds
 * outside it, so it never moves the other way on the stave: positive goes up
 */
export function shiftDrums(phantom: Phantom, steps: number): Phantom {
    return { ...phantom, pitch: stepSounds(phantom.pitch, steps) };
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
