import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Cursor } from '../cursor/Cursor';
import { fraction } from '../fraction/Fraction';
import { selectedLeaves, visualSelection } from './Selection';

const at = (measure: number, leaf: number, part = 0): Cursor => ({ part, measure, voice: 0, leaf, note: 0 });
const leaf = (measure: number, leaf: number, part = 0) => ({ part, measure, voice: 0, leaf });

// Melody: 3 chords (4/4) | 14 tuplet notes (3/4) | 4 events (6/8). Bass: one note per measure.
describe('visual', () => {
    it('selects whole measures of the parts between its ends, whichever way it was made', () => {
        const selection = visualSelection(exampleComposition, 'visual', at(2, 1), at(1, 5, 1));
        expect(selection).toEqual({ kind: 'measures', firstPart: 0, lastPart: 1, first: 1, last: 2 });
        expect(selectedLeaves(exampleComposition, selection)).toHaveLength(14 + 4 + 2);
    });

    it('keeps to one part when both ends are in it', () => {
        const selection = visualSelection(exampleComposition, 'visual', at(0, 2), at(1, 0));
        expect(selectedLeaves(exampleComposition, selection)).toHaveLength(3 + 14);
    });
});

describe('visual block', () => {
    it('spans from the earlier leaf start to the later leaf end', () => {
        const selection = visualSelection(exampleComposition, 'visualBlock', at(1, 0), at(0, 1));
        expect(selection).toEqual({
            kind: 'block',
            firstPart: 0,
            lastPart: 0,
            start: { measure: 0, offset: fraction(1, 4) },
            end: { measure: 1, offset: fraction(1, 12) },
        });
        expect(selectedLeaves(exampleComposition, selection)).toEqual([leaf(0, 1), leaf(0, 2), leaf(1, 0)]);
    });

    it('takes what starts inside the span in every part between the ends', () => {
        // The bass note covers the whole measure, so the block grows to all of it
        const selection = visualSelection(exampleComposition, 'visualBlock', at(1, 3), at(1, 0, 1));
        expect(selectedLeaves(exampleComposition, selection)).toHaveLength(14 + 1);

        // Bass notes starting before the span aren't in it
        const span = { start: { measure: 0, offset: fraction(1, 4) }, end: { measure: 1, offset: fraction(0) } };
        expect(selectedLeaves(exampleComposition, { kind: 'block', firstPart: 0, lastPart: 1, ...span })).toEqual([
            leaf(0, 1),
            leaf(0, 2),
        ]);
    });
});
