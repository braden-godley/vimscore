import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Cursor, cursorPitch } from '../cursor/Cursor';
import { written } from '../edit/written';
import { fraction } from '../fraction/Fraction';
import { Selection } from '../selection/Selection';
import { Register, put, yankNote, yankSelection } from './Register';

const at = (part: number, measure: number, leaf: number, note = 0): Cursor => ({ part, measure, voice: 0, leaf, note });
const block = (part: number, measure: number, from: [number, number], to: [number, number]): Selection => ({
    kind: 'block',
    firstPart: part,
    lastPart: part,
    start: { measure, offset: fraction(...from) },
    end: { measure, offset: fraction(...to) },
});

// Melody: C-E-G q, G-B-D q, C-E-G h (4/4) | triplet, quintuplet, sextuplet (3/4) | C~ q., C 8, C! 8, r 8 (6/8)
// Bass: C whole | G dotted half | C dotted half
describe('notes', () => {
    it('yanks the note under the cursor with its value', () => {
        expect(yankNote(exampleComposition, at(0, 0, 0, 2))).toEqual({
            kind: 'note',
            note: { pitch: 67 },
            duration: { base: 4, dots: 0 },
        });
        expect(yankNote(exampleComposition, at(0, 2, 3))).toBeUndefined();
    });

    it('puts a note into the chord under the cursor, keeping its value', () => {
        const g = yankNote(exampleComposition, at(0, 0, 0, 2))!;
        const put1 = put(exampleComposition, at(0, 0, 1), g, true)!;
        expect(written(put1.composition, 0, 0)).toBe('60,64,67/q 55,59,62,67/q 60,64,67/h');
        expect(cursorPitch(put1.composition, put1.cursor)).toBe(67);
        expect(put(exampleComposition, at(0, 0, 2), g, true)).toBeUndefined();
    });

    it('puts a note in place of a rest, with its own value', () => {
        const c = yankNote(exampleComposition, at(0, 2, 1))!;
        expect(written(put(exampleComposition, at(0, 2, 3), c, false)!.composition, 0, 2)).toBe('72~/q. 72/8 72!/8 72/8');
    });
});

describe('clips', () => {
    const gChord = yankSelection(exampleComposition, block(0, 0, [1, 4], [1, 2]))!;

    it('yank what a selection covers, staff by staff', () => {
        expect(gChord).toMatchObject({ kind: 'clip', measures: false, length: fraction(1, 4) });
        const bars = yankSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 2, last: 2 });
        expect(bars).toMatchObject({ kind: 'clip', measures: true, length: fraction(3, 4) });
        if (bars?.kind === 'clip') expect(bars.parts).toHaveLength(2);
    });

    it('go in at the cursor, or after its chord, writing over what was there', () => {
        expect(written(put(exampleComposition, at(0, 0, 0), gChord, false)!.composition, 0, 0)).toBe(
            '55,59,62/q 55,59,62/q 60,64,67/h',
        );
        // After the half note is the next measure, before the quintuplet
        const next = put(exampleComposition, at(0, 0, 2), gChord, true)!;
        expect(written(next.composition, 0, 1)).toMatch(/^55,59,62\/q \[69\/16/);
        expect(next.cursor).toMatchObject({ measure: 1, leaf: 0 });
    });

    it('go in count times', () => {
        expect(written(put(exampleComposition, at(0, 0, 0), gChord, false, 3)!.composition, 0, 0)).toBe(
            '55,59,62/q 55,59,62/q 55,59,62/q r/q',
        );
    });

    it('tie over barlines they cross', () => {
        const whole = yankSelection(exampleComposition, { kind: 'measures', firstPart: 1, lastPart: 1, first: 0, last: 0 })!;
        const crossed = put(exampleComposition, at(1, 1, 0), whole, false)!.composition;
        expect(written(crossed, 1, 1)).toBe('48~/h.');
        expect(written(crossed, 1, 2)).toBe('48/q r/h');
    });

    it('add measures to go past the end', () => {
        const last = yankSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 2, last: 2 })!;
        const extended = put(exampleComposition, at(0, 2, 0), last, true)!.composition;
        expect(extended.measures).toHaveLength(4);
        expect(written(extended, 0, 3)).toBe(written(exampleComposition, 0, 2));
        expect(written(extended, 1, 3)).toBe('48/h.');
    });

    it('refuse to cut through a tuplet', () => {
        expect(put(exampleComposition, at(0, 1, 1), gChord, false)).toBeUndefined();
    });

    it('stop at the last staff', () => {
        const both: Register = yankSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 0, last: 0 })!;
        // The melody goes on the bass stave; the bass part of the clip has nowhere to go
        const result = put(exampleComposition, at(1, 2, 0), both, false)!.composition;
        expect(written(result, 1, 2)).toBe('60,64,67/q 55,59,62/q 60~,64~,67~/q');
        expect(written(result, 1, 3)).toBe('60,64,67/q r/h');
        expect(written(result, 0, 2)).toBe(written(exampleComposition, 0, 2));
    });
});
