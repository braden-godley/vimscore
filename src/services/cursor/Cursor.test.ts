import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import {
    Cursor,
    START,
    clampCursor,
    cursorPitch,
    cursorSeconds,
    gotoMeasure,
    moveLeaf,
    moveMeasure,
    moveNote,
    movePart,
    startCursor,
} from './Cursor';

const at = (measure: number, leaf: number, part = 0, voice = 0, note = 0): Cursor => ({ part, measure, voice, leaf, note });

// Melody leaves per measure: 3 chords | 14 tuplet notes | 4 events. Bass: one note per measure.
// Melody measure 1 chords: [60, 64, 67], [55, 59, 62], [60, 64, 67]
describe('moveLeaf', () => {
    it('steps through tuplets and across barlines', () => {
        expect(moveLeaf(exampleComposition, at(0, 2), 1)).toEqual(at(1, 0));
        expect(moveLeaf(exampleComposition, at(1, 0), -1)).toEqual(at(0, 2, 0, 0, 2));
        expect(moveLeaf(exampleComposition, at(0, 0), 5)).toEqual(at(1, 2));
    });

    it('stops at the ends of the part', () => {
        expect(moveLeaf(exampleComposition, START, -3)).toEqual(START);
        expect(moveLeaf(exampleComposition, at(2, 2), 10)).toEqual(at(2, 3));
    });

    it('keeps to the closest pitch in the next chord', () => {
        // 64 is nearer 62 than 59, and 60 nearer 59 than 55
        expect(moveLeaf(exampleComposition, at(0, 0, 0, 0, 1), 1)).toEqual(at(0, 1, 0, 0, 2));
        expect(moveLeaf(exampleComposition, at(0, 0, 0, 0, 0), 1)).toEqual(at(0, 1, 0, 0, 1));
    });
});

describe('moveNote', () => {
    it('steps through the chord by pitch', () => {
        expect(cursorPitch(exampleComposition, moveNote(exampleComposition, START, 1))).toBe(64);
        expect(moveNote(exampleComposition, at(0, 0, 0, 0, 2), -2)).toEqual(START);
    });

    it('crosses into the next stave past the bottom or top note', () => {
        // Down from the bottom of the melody's chord to the bass
        expect(moveNote(exampleComposition, START, -1)).toEqual(at(0, 0, 1));
        expect(moveNote(exampleComposition, at(0, 0, 0, 0, 2), -3)).toEqual(at(0, 0, 1));
        // Up from the bass lands on the bottom note of the chord sounding at the same time
        expect(moveNote(exampleComposition, at(0, 0, 1), 1)).toEqual(START);
        expect(moveNote(exampleComposition, at(0, 0, 1), 2)).toEqual(at(0, 0, 0, 0, 1));
    });

    it('stops where there is no stave', () => {
        expect(moveNote(exampleComposition, at(0, 0, 0, 0, 2), 5)).toEqual(at(0, 0, 0, 0, 2));
        expect(moveNote(exampleComposition, at(0, 0, 1), -5)).toEqual(at(0, 0, 1));
    });

    it('crosses straight from a rest', () => {
        expect(moveNote(exampleComposition, at(2, 3), 1)).toEqual(at(2, 3));
        expect(moveNote(exampleComposition, at(2, 3), -1)).toEqual(at(2, 0, 1));
    });
});

describe('moveMeasure', () => {
    it('lands on the first leaf and clamps', () => {
        expect(moveMeasure(exampleComposition, at(0, 2), 1)).toEqual(at(1, 0));
        expect(moveMeasure(exampleComposition, at(1, 4), 9)).toEqual(at(2, 0));
        expect(gotoMeasure(exampleComposition, at(2, 1), 0)).toEqual(at(0, 0, 0, 0, 2));
    });
});

describe('movePart', () => {
    it('lands on the leaf sounding at the same time, on its top note', () => {
        // The bass holds one note through the whole measure
        expect(movePart(exampleComposition, at(0, 2), 1)).toEqual(at(0, 0, 1));
        expect(movePart(exampleComposition, at(0, 0, 1), -1)).toEqual(at(0, 0, 0, 0, 2));
        expect(movePart(exampleComposition, at(0, 0, 1), 5)).toEqual(at(0, 0, 1));
    });
});

describe('clampCursor', () => {
    it('falls back to voice 0 and the nearest leaf and note', () => {
        expect(clampCursor(exampleComposition, at(0, 99, 0, 3, 9))).toEqual(at(0, 2, 0, 0, 2));
        expect(clampCursor(exampleComposition, at(7, 99, 7, 0, 9))).toEqual(at(2, 0, 1));
    });
});

describe('startCursor', () => {
    it('selects the top note of the first chord', () => {
        expect(startCursor(exampleComposition)).toEqual(at(0, 0, 0, 0, 2));
    });
});

describe('cursorSeconds', () => {
    it('follows tuplets and tempo changes', () => {
        // Measure 2 starts at 2s; a triplet eighth is a sixth of a second at quarter = 120
        expect(cursorSeconds(exampleComposition, at(1, 1))).toBeCloseTo(2 + 1 / 6);
        // Measure 3 starts at 3.5s at dotted quarter = 60, so the second leaf is a second in
        expect(cursorSeconds(exampleComposition, at(2, 1))).toBeCloseTo(4.5);
    });
});
