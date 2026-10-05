import { describe, expect, it } from 'vitest';
import { fraction } from '../fraction/Fraction';
import { DEFAULT_TEMPO, DEFAULT_TIME_SIGNATURE, measureAtTime, resolveMeasures, secondsPerWholeNote } from './Measure';

describe('secondsPerWholeNote', () => {
    it('accounts for the beat unit', () => {
        expect(secondsPerWholeNote({ bpm: 120, beat: { base: 4, dots: 0 } })).toBe(2);
        expect(secondsPerWholeNote({ bpm: 60, beat: { base: 4, dots: 1 } })).toBeCloseTo(8 / 3);
    });
});

describe('resolveMeasures', () => {
    it('falls back to defaults', () => {
        const [measure] = resolveMeasures([{}]);
        expect(measure?.timeSignature).toEqual(DEFAULT_TIME_SIGNATURE);
        expect(measure?.tempo).toEqual(DEFAULT_TEMPO);
    });

    it('carries changes forward and accumulates position', () => {
        const threeFour = { beats: 3, beatValue: 4 };
        const slow = { bpm: 60, beat: { base: 4, dots: 0 } } as const;

        const measures = resolveMeasures([{}, { timeSignature: threeFour }, { tempo: slow }, {}]);

        expect(measures.map((m) => m.timeSignature)).toEqual([
            DEFAULT_TIME_SIGNATURE,
            threeFour,
            threeFour,
            threeFour,
        ]);
        expect(measures.map((m) => m.tempo)).toEqual([DEFAULT_TEMPO, DEFAULT_TEMPO, slow, slow]);
        expect(measures.map((m) => m.start)).toEqual([
            fraction(0),
            fraction(1),
            fraction(7, 4),
            fraction(10, 4),
        ]);
        // 4 beats at 120, 3 at 120, 3 at 60
        expect(measures.map((m) => m.startSeconds)).toEqual([0, 2, 3.5, 6.5]);
    });
});

describe('measureAtTime', () => {
    it('finds the measure containing a time, clamping at both ends', () => {
        // Each 4/4 measure lasts 2s at the default tempo
        const measures = resolveMeasures([{}, {}, {}]);
        expect([-1, 0, 1.99, 2, 5, 100].map((t) => measureAtTime(measures, t))).toEqual([0, 0, 0, 1, 2, 2]);
    });
});
