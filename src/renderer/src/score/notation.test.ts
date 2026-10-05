import { describe, expect, it } from 'vitest';
import { durationCode, pitchKey } from './notation';

describe('pitchKey', () => {
    it('spells MIDI pitches with sharps in scientific octaves', () => {
        expect(pitchKey(60)).toBe('c/4');
        expect(pitchKey(61)).toBe('c#/4');
        expect(pitchKey(59)).toBe('b/3');
        expect(pitchKey(21)).toBe('a/0');
    });
});

describe('durationCode', () => {
    it('ignores dots, which VexFlow takes separately', () => {
        expect(durationCode({ base: 4, dots: 1 })).toBe('q');
        expect(durationCode({ base: 16, dots: 0 })).toBe('16');
    });
});
