/**
 * The cursor selects one note of a chord, or a rest, while editing. It names a leaf (see `leaves`)
 * by its position in the voice's flattened events, so tuplets don't need special handling to
 * step through.
 */

import { Composition } from '../composition/Composition';
import { Leaf, leaves } from '../event/Event';
import { Fraction, ZERO, add, compare, toNumber } from '../fraction/Fraction';
import { resolveMeasures, secondsPerWholeNote } from '../measure/Measure';

export interface Cursor {
    part: number;
    measure: number;
    voice: number;
    /** Index into the voice's leaves in this measure */
    leaf: number;
    /** Index into the chord's notes, as stored (not sorted by pitch). Always 0 on a rest */
    note: number;
}

export const START: Cursor = { part: 0, measure: 0, voice: 0, leaf: 0, note: 0 };

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** The chords and rests of one voice in one measure. Empty if the voice doesn't exist there */
export function voiceLeaves(composition: Composition, part: number, measure: number, voice: number): Leaf[] {
    const events = composition.parts[part]?.measures[measure]?.voices[voice]?.events;
    return events ? [...leaves(events)] : [];
}

function cursorLeaf(composition: Composition, cursor: Cursor): Leaf | undefined {
    return voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf];
}

/** Pitch of the selected note, or undefined on a rest */
export function cursorPitch(composition: Composition, cursor: Cursor): number | undefined {
    const event = cursorLeaf(composition, cursor)?.event;
    return event?.kind === 'chord' ? event.notes[cursor.note]?.pitch : undefined;
}

/** Which note of a chord to land on: the one closest to a pitch, or the top or bottom one */
type NoteChoice = number | 'top' | 'bottom';

/**
 * Picks the note to select in the cursor's chord. Following a pitch keeps stepping through
 * chords to the same line; on a tie, the higher note wins.
 */
function withNote(composition: Composition, cursor: Cursor, choice: NoteChoice): Cursor {
    const event = cursorLeaf(composition, cursor)?.event;
    if (event?.kind !== 'chord' || event.notes.length === 0) return { ...cursor, note: 0 };

    const distance = (pitch: number) =>
        choice === 'top' ? -pitch : choice === 'bottom' ? pitch : Math.abs(pitch - choice);

    let best = 0;
    event.notes.forEach(({ pitch }, i) => {
        const current = event.notes[best]!.pitch;
        if (distance(pitch) < distance(current) || (distance(pitch) === distance(current) && pitch > current)) best = i;
    });
    return { ...cursor, note: best };
}

/** Where editing starts: the top note of the first chord in the first part */
export function startCursor(composition: Composition): Cursor {
    return withNote(composition, clampCursor(composition, START), 'top');
}

/** Start of the cursor's leaf, in whole notes from the start of its measure */
export function cursorOffset(composition: Composition, cursor: Cursor): Fraction {
    let offset = ZERO;
    for (const { length } of voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice).slice(0, cursor.leaf)) {
        offset = add(offset, length);
    }
    return offset;
}

/** When the cursor's leaf starts, in seconds from the start of the composition */
export function cursorSeconds(composition: Composition, cursor: Cursor): number {
    const measure = resolveMeasures(composition.measures)[cursor.measure];
    if (!measure) return 0;
    return measure.startSeconds + toNumber(cursorOffset(composition, cursor)) * secondsPerWholeNote(measure.tempo);
}

/** The leaf sounding at `offset`: the last one starting at or before it */
function leafAtOffset(leafList: Leaf[], offset: Fraction): number {
    let start = ZERO;
    let index = 0;
    leafList.forEach(({ length }, i) => {
        if (compare(start, offset) <= 0) index = i;
        start = add(start, length);
    });
    return index;
}

/** Moves the cursor onto something that exists, falling back to voice 0 when its voice doesn't */
export function clampCursor(composition: Composition, cursor: Cursor): Cursor {
    const part = clamp(cursor.part, 0, composition.parts.length - 1);
    const measure = clamp(cursor.measure, 0, composition.measures.length - 1);
    const voice = voiceLeaves(composition, part, measure, cursor.voice).length > 0 ? cursor.voice : 0;
    const leafList = voiceLeaves(composition, part, measure, voice);
    const leaf = clamp(cursor.leaf, 0, Math.max(0, leafList.length - 1));
    const event = leafList[leaf]?.event;
    const noteCount = event?.kind === 'chord' ? event.notes.length : 1;
    return { part, measure, voice, leaf, note: clamp(cursor.note, 0, Math.max(0, noteCount - 1)) };
}

/**
 * Steps `delta` chords or rests through the cursor's voice, crossing barlines and skipping
 * measures where the voice is empty. Stops at the first or last leaf of the part.
 */
export function moveLeaf(composition: Composition, cursor: Cursor, delta: number): Cursor {
    const { part, voice } = cursor;
    let { measure, leaf } = cursor;
    const step = Math.sign(delta);

    for (let remaining = Math.abs(delta); remaining > 0; remaining--) {
        const next = leaf + step;
        if (next >= 0 && next < voiceLeaves(composition, part, measure, voice).length) {
            leaf = next;
            continue;
        }

        // Find the next measure in this direction that has something in the voice
        let target = measure + step;
        while (target >= 0 && target < composition.measures.length && voiceLeaves(composition, part, target, voice).length === 0) {
            target += step;
        }
        if (target < 0 || target >= composition.measures.length) break;

        measure = target;
        leaf = step > 0 ? 0 : voiceLeaves(composition, part, measure, voice).length - 1;
    }

    return withNote(composition, { ...cursor, measure, leaf }, cursorPitch(composition, cursor) ?? 'top');
}

/**
 * Steps through the chord by pitch: positive goes up. Past the top or bottom note, or from a
 * rest, it carries on into the stave above or below, and stops where there isn't one.
 */
export function moveNote(composition: Composition, cursor: Cursor, delta: number): Cursor {
    const step = Math.sign(delta);
    let current = cursor;

    for (let remaining = Math.abs(delta); remaining > 0; remaining--) {
        const event = cursorLeaf(composition, current)?.event;
        if (event?.kind === 'chord') {
            const byPitch = event.notes.map((_, i) => i).sort((a, b) => event.notes[a]!.pitch - event.notes[b]!.pitch);
            const next = byPitch[byPitch.indexOf(current.note) + step];
            if (next !== undefined) {
                current = { ...current, note: next };
                continue;
            }
        }

        // Parts are listed top to bottom, so going up in pitch means a lower part index
        const part = current.part - step;
        if (part < 0 || part >= composition.parts.length) break;
        current = movePart(composition, current, -step, step > 0 ? 'bottom' : 'top');
    }

    return current;
}

/** Jumps to the first leaf of a measure, keeping the part and (where it exists) the voice */
export function gotoMeasure(composition: Composition, cursor: Cursor, measure: number): Cursor {
    const target = clampCursor(composition, { ...cursor, measure, leaf: 0 });
    return withNote(composition, target, cursorPitch(composition, cursor) ?? 'top');
}

/**
 * Goes back `count` measure starts: the first beat of the cursor's own measure counts as one,
 * unless the cursor is already on it.
 */
export function backToMeasureStart(composition: Composition, cursor: Cursor, count: number): Cursor {
    const steps = cursor.leaf > 0 ? count - 1 : count;
    return gotoMeasure(composition, cursor, cursor.measure - steps);
}

export function moveMeasure(composition: Composition, cursor: Cursor, delta: number): Cursor {
    return gotoMeasure(composition, cursor, cursor.measure + delta);
}

/**
 * Moves to another part in the same measure, landing on whatever sounds at the cursor's time.
 * Parts are usually in different registers, so this takes the top or bottom note rather than
 * the nearest.
 */
export function movePart(composition: Composition, cursor: Cursor, delta: number, land: 'top' | 'bottom' = 'top'): Cursor {
    const part = clamp(cursor.part + delta, 0, composition.parts.length - 1);
    const offset = cursorOffset(composition, cursor);
    const leaf = leafAtOffset(voiceLeaves(composition, part, cursor.measure, 0), offset);
    const target = clampCursor(composition, { part, measure: cursor.measure, voice: 0, leaf, note: 0 });
    return withNote(composition, target, land);
}
