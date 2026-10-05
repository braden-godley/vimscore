import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { setKeySignature, setTempo, setTimeSignature } from './MeasureChanges';
import { written } from './written';

const quarter = { base: 4, dots: 0 } as const;

// Melody: C-E-G q, G-B-D q, C-E-G h (4/4) | triplet, quintuplet, sextuplet (3/4) | C~ q., C 8, C! 8, r 8 (6/8)
// Bass: C whole | G dotted half | C dotted half
describe('setTimeSignature', () => {
    it('re-bars the music up to the next time signature, tying notes over the new barlines', () => {
        const changed = setTimeSignature(exampleComposition, 0, { beats: 3, beatValue: 4 });
        expect(changed.measures).toHaveLength(4);
        expect(changed.measures[0]).toMatchObject({ timeSignature: { beats: 3, beatValue: 4 }, tempo: { bpm: 120 } });
        expect(written(changed, 0, 0)).toBe('60,64,67/q 55,59,62/q 60~,64~,67~/q');
        expect(written(changed, 0, 1)).toBe('60,64,67/q r/q r/q');
        expect(written(changed, 1, 0)).toBe('48~/h.');
        expect(written(changed, 1, 1)).toBe('48/q r/q r/q');
        // What came after is untouched, one measure later
        expect(changed.parts[0]!.measures[2]).toBe(exampleComposition.parts[0]!.measures[1]);
    });

    it('keeps ties and staccato where they were', () => {
        const changed = setTimeSignature(exampleComposition, 2, { beats: 2, beatValue: 4 });
        expect(written(changed, 0, 2)).toBe('72~/q. 72/8');
        expect(written(changed, 0, 3)).toBe('72!/8 r/8 r/q');
        expect(changed.measures[2]).toMatchObject({ tempo: { bpm: 60 } });
    });

    it('moves a tuplet that would cross a barline into the next measure', () => {
        const changed = setTimeSignature(exampleComposition, 1, { beats: 5, beatValue: 8 });
        expect(written(changed, 0, 1)).toMatch(/^\[.*\] \[.*\] r\/8$/);
        expect(written(changed, 0, 2)).toMatch(/^\[77\/16 .*\] r\/q r\/8$/);
        expect(written(changed, 1, 1)).toBe('43~/h 43~/8');
        expect(written(changed, 1, 2)).toBe('43/8 r/8 r/q r/8');
    });

    it('leaves no change marked when it matches the measure before', () => {
        const changed = setTimeSignature(exampleComposition, 1, { beats: 4, beatValue: 4 });
        expect(changed.measures[1]?.timeSignature).toBeUndefined();
        expect(written(changed, 1, 1)).toBe('43/h. r/q');
    });
});

describe('setKeySignature and setTempo', () => {
    it('set the value from that measure on', () => {
        expect(setKeySignature(exampleComposition, 1, { fifths: 2 }).measures[1]).toEqual({
            timeSignature: { beats: 3, beatValue: 4 },
            keySignature: { fifths: 2 },
        });
        expect(setTempo(exampleComposition, 1, { bpm: 90, beat: quarter }).measures[1]?.tempo).toEqual({
            bpm: 90,
            beat: quarter,
        });
    });

    it('drop a change that matches the measure before', () => {
        const keyed = setKeySignature(exampleComposition, 1, { fifths: 2 });
        expect(setKeySignature(keyed, 1, { fifths: 0 }).measures[1]?.keySignature).toBeUndefined();
        expect(setTempo(exampleComposition, 1, { bpm: 120, beat: quarter }).measures[1]?.tempo).toBeUndefined();
    });
});

describe('repeated changes', () => {
    it('are dropped after re-barring', () => {
        // Measure 2 was already 3/4, so once measure 1 is too it no longer marks a change
        const changed = setTimeSignature(exampleComposition, 0, { beats: 3, beatValue: 4 });
        expect(changed.measures[2]?.timeSignature).toBeUndefined();
        expect(changed.measures[3]?.timeSignature).toEqual({ beats: 6, beatValue: 8 });
    });
});
