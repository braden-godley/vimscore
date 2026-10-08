import { describe, expect, it } from 'vitest';
import { describePhantom, durationCode, keySpec, noteKey, pitchKey } from './notation';
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

describe('noteKey', () => {
    it('writes pitches where they are on pitched staves', () => {
        expect(noteKey(pitch('F#2'), 'treble')).toBe('f#/2');
    });

    it('writes drums on their line or space, with their notehead', () => {
        expect(noteKey(pitch('C2'), 'percussion')).toBe('f/4');
        expect(noteKey(pitch('D2'), 'percussion')).toBe('c/5');
        expect(noteKey(pitch('F#2'), 'percussion')).toBe('g/5/x');
        expect(noteKey(pitch('Gb2'), 'percussion')).toBe('g/5/x');
        expect(noteKey(pitch('C#3'), 'percussion')).toBe('a/5/x');
        expect(noteKey(pitch('F3'), 'percussion')).toBe('f/5/di');
    });

    it('writes sounds outside the kit at their pitch, without accidentals', () => {
        expect(noteKey(pitch('C#4'), 'percussion')).toBe('c/4');
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
        expect(describePhantom({ pitch: pitch('C4'), duration: { base: 4, dots: 0 } })).toBe('C4 quarter');
        expect(describePhantom({ pitch: pitch('A#4'), duration: { base: 2, dots: 1 }, staccato: true })).toBe('A♯4 dotted half staccato');
        expect(describePhantom({ pitch: pitch('Eb4'), duration: { base: 4, dots: 0 } })).toBe('E♭4 quarter');
        expect(describePhantom({ pitch: pitch('G4'), duration: { base: 8, dots: 0 }, tenuto: true, marcato: true })).toBe(
            'G4 eighth tenuto marcato',
        );
    });

    it('names the drum on a percussion staff', () => {
        expect(describePhantom({ pitch: pitch('F#2'), duration: { base: 8, dots: 0 } }, 'percussion')).toBe('Closed Hi-Hat F♯2 eighth');
        expect(describePhantom({ pitch: pitch('C#4'), duration: { base: 4, dots: 0 } }, 'percussion')).toBe('C♯4 quarter');
        expect(describePhantom({ pitch: pitch('F#2'), duration: { base: 8, dots: 0 } }, 'treble')).toBe('F♯2 eighth');
    });
});

describe('keySpec', () => {
    it('names keys for VexFlow', () => {
        expect(keySpec({ fifths: 0 })).toBe('C');
        expect(keySpec({ fifths: 3 })).toBe('A');
        expect(keySpec({ fifths: -2 })).toBe('Bb');
    });
});
