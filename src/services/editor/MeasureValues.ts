/**
 * Reading what's typed after `:time`, `:key` and `:tempo` into the values they set.
 */

import { Duration } from '../duration/Duration';
import { KeySignature } from '../key/KeySignature';
import { TimeSignature } from '../measure/Measure';

const BASES = [1, 2, 4, 8, 16, 32, 64];

/** `3/4`, `6/8` */
export function parseTimeSignature(text: string): TimeSignature | undefined {
    const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
    if (!match) return undefined;
    const [beats, beatValue] = [Number(match[1]), Number(match[2])];
    return beats >= 1 && beats <= 64 && BASES.includes(beatValue) ? { beats, beatValue } : undefined;
}

/** Sharps or flats away from C, by letter, counted in fifths */
const LETTER_FIFTHS: Record<string, number> = { f: -1, c: 0, g: 1, d: 2, a: 3, e: 4, b: 5 };

/**
 * A key by name, `D`, `Bb`, `F#m` (minor with `m`), or by its signature, `2#`, `3b`, `0`.
 * Minor keys share their relative major's signature, three fifths flatter.
 */
export function parseKeySignature(text: string): KeySignature | undefined {
    const trimmed = text.trim();
    const counted = /^([0-7])\s*([#b]?)$/.exec(trimmed);
    if (counted) {
        const [, count = '0', sign] = counted;
        if (count !== '0' && !sign) return undefined;
        return { fifths: sign === 'b' ? -Number(count) : Number(count) };
    }

    const named = /^([A-Ga-g])([#b]?)(m?)$/.exec(trimmed);
    if (!named) return undefined;
    const [, letter = '', accidental, minor] = named;
    const fifths =
        LETTER_FIFTHS[letter.toLowerCase()]! + (accidental === '#' ? 7 : accidental === 'b' ? -7 : 0) - (minor ? 3 : 0);
    return fifths >= -7 && fifths <= 7 ? { fifths } : undefined;
}

const BEAT_LETTERS: Record<string, Duration['base']> = { w: 1, h: 2, q: 4, e: 8, s: 16 };

/** `120`, `q=120`, `q.=60`, `h=60`. Without a beat, the tempo keeps the beat it already counts */
export function parseTempo(text: string): { bpm: number; beat?: Duration } | undefined {
    const match = /^\s*(?:([whqes])(\.?)\s*=\s*)?(\d+(?:\.\d+)?)\s*$/.exec(text);
    if (!match) return undefined;
    const [, letter, dot, bpmText] = match;
    const bpm = Number(bpmText);
    if (!(bpm > 0 && bpm <= 1000)) return undefined;
    return letter ? { bpm, beat: { base: BEAT_LETTERS[letter]!, dots: dot ? 1 : 0 } } : { bpm };
}
