import { describe, expect, it } from 'vitest';
import { Composition, withTrailingEmptyMeasure } from './Composition';
import { exampleComposition } from './example-composition';

describe('withTrailingEmptyMeasure', () => {
    it('adds a measure of rests in the last time signature', () => {
        const result = withTrailingEmptyMeasure(exampleComposition);
        expect(result.measures).toHaveLength(4);
        expect(result.measures[3]).toEqual({});
        for (const part of result.parts) {
            expect(part.measures).toHaveLength(4);
            // The example ends in 6/8, which is a dotted half
            expect(part.measures[3]).toEqual({ voices: [{ events: [{ kind: 'rest', duration: { base: 2, dots: 1 } }] }] });
        }
    });

    it('leaves a composition that already ends empty alone', () => {
        const once = withTrailingEmptyMeasure(exampleComposition);
        expect(withTrailingEmptyMeasure(once)).toBe(once);
    });

    it('counts a measure with only rests or no events as empty', () => {
        const composition: Composition = {
            title: 'Test',
            measures: [{}],
            parts: [
                { name: 'A', program: 0, measures: [{ voices: [{ events: [{ kind: 'rest', duration: { base: 1, dots: 0 } }] }] }] },
                { name: 'B', program: 0, measures: [{ voices: [] }] },
            ],
            soundfont: { filePath: '' },
        };
        expect(withTrailingEmptyMeasure(composition)).toBe(composition);
    });

    it('gives an empty composition its first measure', () => {
        const composition: Composition = {
            title: 'Test',
            measures: [],
            parts: [{ name: 'A', program: 0, measures: [] }],
            soundfont: { filePath: '' },
        };
        const result = withTrailingEmptyMeasure(composition);
        expect(result.parts[0]?.measures[0]?.voices[0]?.events).toEqual([{ kind: 'rest', duration: { base: 1, dots: 0 } }]);
    });
});
