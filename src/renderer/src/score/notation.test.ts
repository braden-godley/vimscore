import { describe, expect, it } from 'vitest';
import { describePhantom, durationCode, keySpec, pitchKey } from './notation';

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

describe('describePhantom', () => {
    it('names the pitch, value and articulation', () => {
        expect(describePhantom({ pitch: 60, duration: { base: 4, dots: 0 }, staccato: false })).toBe('C4 quarter');
        expect(describePhantom({ pitch: 70, duration: { base: 2, dots: 1 }, staccato: true })).toBe('A♯4 dotted half staccato');
    });
});

describe('key signatures', () => {
    it('spells black keys with flats in flat keys', () => {
        expect(pitchKey(70, { fifths: -1 })).toBe('bb/4');
        expect(pitchKey(70, { fifths: 2 })).toBe('a#/4');
        expect(describePhantom({ pitch: 63, duration: { base: 4, dots: 0 }, staccato: false }, { fifths: -3 })).toBe('E♭4 quarter');
    });

    it('names keys for VexFlow', () => {
        expect(keySpec({ fifths: 0 })).toBe('C');
        expect(keySpec({ fifths: 3 })).toBe('A');
        expect(keySpec({ fifths: -2 })).toBe('Bb');
    });
});
