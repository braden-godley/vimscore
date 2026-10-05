import { describe, expect, it } from 'vitest';
import { parseKeySignature, parseTempo, parseTimeSignature } from './Prompt';

describe('parseTimeSignature', () => {
    it('reads beats over a note value', () => {
        expect(parseTimeSignature('3/4')).toEqual({ beats: 3, beatValue: 4 });
        expect(parseTimeSignature(' 12 / 8 ')).toEqual({ beats: 12, beatValue: 8 });
        expect(parseTimeSignature('3/5')).toBeUndefined();
        expect(parseTimeSignature('0/4')).toBeUndefined();
        expect(parseTimeSignature('3')).toBeUndefined();
    });
});

describe('parseKeySignature', () => {
    it('reads major and minor keys by name', () => {
        expect(parseKeySignature('C')).toEqual({ fifths: 0 });
        expect(parseKeySignature('D')).toEqual({ fifths: 2 });
        expect(parseKeySignature('Bb')).toEqual({ fifths: -2 });
        expect(parseKeySignature('bb')).toEqual({ fifths: -2 });
        expect(parseKeySignature('F#')).toEqual({ fifths: 6 });
        expect(parseKeySignature('Am')).toEqual({ fifths: 0 });
        expect(parseKeySignature('F#m')).toEqual({ fifths: 3 });
        expect(parseKeySignature('Ebm')).toEqual({ fifths: -6 });
    });

    it('reads a count of sharps or flats', () => {
        expect(parseKeySignature('2#')).toEqual({ fifths: 2 });
        expect(parseKeySignature('3b')).toEqual({ fifths: -3 });
        expect(parseKeySignature('0')).toEqual({ fifths: 0 });
    });

    it('rejects keys that need more than seven', () => {
        expect(parseKeySignature('Fb')).toBeUndefined();
        expect(parseKeySignature('8#')).toBeUndefined();
        expect(parseKeySignature('3')).toBeUndefined();
        expect(parseKeySignature('H')).toBeUndefined();
    });
});

describe('parseTempo', () => {
    const quarter = { base: 4, dots: 0 } as const;

    it('keeps the current beat for a bare number', () => {
        expect(parseTempo('90', quarter)).toEqual({ bpm: 90, beat: quarter });
        expect(parseTempo('60', { base: 4, dots: 1 })).toEqual({ bpm: 60, beat: { base: 4, dots: 1 } });
    });

    it('takes a beat before an equals sign', () => {
        expect(parseTempo('q.=60', quarter)).toEqual({ bpm: 60, beat: { base: 4, dots: 1 } });
        expect(parseTempo('h = 72', quarter)).toEqual({ bpm: 72, beat: { base: 2, dots: 0 } });
    });

    it('rejects anything else', () => {
        expect(parseTempo('fast', quarter)).toBeUndefined();
        expect(parseTempo('0', quarter)).toBeUndefined();
        expect(parseTempo('x=60', quarter)).toBeUndefined();
    });
});
