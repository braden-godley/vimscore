/**
 * What visual mode selects, worked out from where it started (the anchor) and the cursor.
 * Both take a range of parts: visual mode whole measures of them, visual block a span of time.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorOffset, voiceLeaves } from '../cursor/Cursor';
import { Fraction, ZERO, add, compare } from '../fraction/Fraction';
import { midi } from '../pitch/Pitch';

/** A moment in the score: a measure and whole notes into it */
export interface TimePoint {
    measure: number;
    offset: Fraction;
}

export type Selection =
    /** Measures `first`..`last` of parts `firstPart`..`lastPart` */
    | { kind: 'measures'; firstPart: number; lastPart: number; first: number; last: number }
    /** Every chord or rest in parts `firstPart`..`lastPart` starting at or after `start` and before `end` */
    | { kind: 'block'; firstPart: number; lastPart: number; start: TimePoint; end: TimePoint };

export type VisualKind = 'visual' | 'visualBlock';

/** One chord or rest: a cursor without the note */
export type LeafRef = Omit<Cursor, 'note'>;

function compareTime(a: TimePoint, b: TimePoint): number {
    return a.measure - b.measure || compare(a.offset, b.offset);
}

function leafStart(composition: Composition, cursor: Cursor): TimePoint {
    return { measure: cursor.measure, offset: cursorOffset(composition, cursor) };
}

function leafEnd(composition: Composition, cursor: Cursor): TimePoint {
    const { measure, offset } = leafStart(composition, cursor);
    const leaf = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf];
    return { measure, offset: leaf ? add(offset, leaf.length) : offset };
}

export function visualSelection(composition: Composition, kind: VisualKind, anchor: Cursor, cursor: Cursor): Selection {
    const parts = { firstPart: Math.min(anchor.part, cursor.part), lastPart: Math.max(anchor.part, cursor.part) };
    if (kind === 'visual') {
        return {
            kind: 'measures',
            ...parts,
            first: Math.min(anchor.measure, cursor.measure),
            last: Math.max(anchor.measure, cursor.measure),
        };
    }

    const starts = [leafStart(composition, anchor), leafStart(composition, cursor)].sort(compareTime);
    const ends = [leafEnd(composition, anchor), leafEnd(composition, cursor)].sort(compareTime);
    return { kind: 'block', ...parts, start: starts[0]!, end: ends[1]! };
}

/** Every chord and rest a selection covers, in part, measure, voice, leaf order */
export function selectedLeaves(composition: Composition, selection: Selection): LeafRef[] {
    const { firstPart, lastPart } = selection;
    const [firstMeasure, lastMeasure] =
        selection.kind === 'measures'
            ? [selection.first, selection.last]
            : [selection.start.measure, selection.end.measure];

    const result: LeafRef[] = [];
    for (let part = firstPart; part <= lastPart; part++) {
        for (let measure = firstMeasure; measure <= lastMeasure; measure++) {
            const voices = composition.parts[part]?.measures[measure]?.voices ?? [];
            voices.forEach((_, voice) => {
                let offset = ZERO;
                voiceLeaves(composition, part, measure, voice).forEach(({ length }, leaf) => {
                    const time = { measure, offset };
                    const inside =
                        selection.kind === 'measures' ||
                        (compareTime(time, selection.start) >= 0 && compareTime(time, selection.end) < 0);
                    if (inside) result.push({ part, measure, voice, leaf });
                    offset = add(offset, length);
                });
            });
        }
    }
    return result;
}

/**
 * The pitches of every selected chord, if they all start at the same moment and last as long:
 * one chord, possibly spread across parts. Undefined otherwise, or if only rests are selected.
 */
export function selectedChordPitches(composition: Composition, selection: Selection): number[] | undefined {
    let first: { time: TimePoint; length: Fraction } | undefined;
    const pitches: number[] = [];

    for (const ref of selectedLeaves(composition, selection)) {
        const leaf = voiceLeaves(composition, ref.part, ref.measure, ref.voice)[ref.leaf];
        if (leaf?.event.kind !== 'chord') continue;

        const time = leafStart(composition, { ...ref, note: 0 });
        first ??= { time, length: leaf.length };
        if (compareTime(time, first.time) !== 0 || compare(leaf.length, first.length) !== 0) return undefined;
        pitches.push(...leaf.event.notes.map(({ pitch }) => midi(pitch)));
    }
    return pitches.length > 0 ? pitches : undefined;
}
