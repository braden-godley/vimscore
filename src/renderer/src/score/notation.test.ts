import { describe, expect, it } from 'vitest';
import { describePhantom, durationCode, keySpec, pitchKey } from './notation';
import { pitch } from '../../../services/pitch/Pitch';

describe('pitchKey', () => {
    it('writes the spelling in scientific octaves', () => {
        expect(pitchKey(pitch('C4'))).toBe('c/4');
        expect(pitchKey(pitch('C#4'))).toBe('c#/4');
        expect(pitchKey(pitch('Bb3'))).toBe('bb/3');
        expect(pitchKey(pitch('Ebb2'))).toBe('ebb/2');
        expect(pitchKey(pitch('A0'))).toBe('a/0');
    });
});

describe('durationCode', () => {
    it('ignores dots, which VexFlow takes separately', () => {
        expect(durationCode({ base: 4, dots: 1 })).toBe('q');
        expect(durationCode({ base: 16, dots: 0 })).toBe('16');
    });
});

describe('describePhantom', () => {
    it('names the pitch as spelled, value and articulation', () => {
        expect(describePhantom({ pitch: pitch('C4'), duration: { base: 4, dots: 0 }, staccato: false })).toBe('C4 quarter');
        expect(describePhantom({ pitch: pitch('A#4'), duration: { base: 2, dots: 1 }, staccato: true })).toBe('A♯4 dotted half staccato');
        expect(describePhantom({ pitch: pitch('Eb4'), duration: { base: 4, dots: 0 }, staccato: false })).toBe('E♭4 quarter');
    });
});

describe('keySpec', () => {
    it('names keys for VexFlow', () => {
        expect(keySpec({ fifths: 0 })).toBe('C');
        expect(keySpec({ fifths: 3 })).toBe('A');
        expect(keySpec({ fifths: -2 })).toBe('Bb');
    });
});
