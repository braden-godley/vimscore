/**
 * A written pitch: a letter of the scale, raised or lowered by sharps and flats, in an octave.
 * A♯4 and B♭4 sound the same but are different notes on the page, so the score keeps the
 * spelling and works out the sounding (MIDI) pitch from it when it needs one.
 */

import { KeySignature } from '../key/KeySignature';

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface Pitch {
    letter: Letter;
    /** Sharps (positive) or flats (negative): -2 is a double flat, 0 natural, 1 a sharp */
    alter: number;
    /** Scientific pitch notation: octave 4 runs from middle C up to the B above */
    octave: number;
}

export const LETTERS: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** Semitones above C of each natural letter */
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
/** The order sharps are added to a key signature; flats go in reverse */
const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAX_ALTER = 2;

export const LOWEST_MIDI = 0;
export const HIGHEST_MIDI = 127;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** MIDI note number: 60 is middle C (C4) */
export function midi({ letter, alter, octave }: Pitch): number {
    return (octave + 1) * 12 + NATURALS[LETTERS.indexOf(letter)]! + alter;
}

/** The key's note `steps` letters away, carrying into the next or previous octave */
function letterAt(pitch: Pitch, steps: number, key: KeySignature): Pitch {
    const index = LETTERS.indexOf(pitch.letter) + steps;
    const letter = LETTERS[mod(index, 7)]!;
    return { letter, alter: keyAlter(letter, key), octave: pitch.octave + Math.floor(index / 7) };
}

/** How a key signature alters a letter: 1 for F in G major, -1 for B in F major */
export function keyAlter(letter: Letter, { fifths }: KeySignature): number {
    const index = SHARP_ORDER.indexOf(letter);
    if (fifths >= 0) return index < fifths ? 1 : 0;
    return 6 - index < -fifths ? -1 : 0;
}

/**
 * Spells a MIDI note: on the key's own note if it has one, and otherwise as a sharp, or a flat
 * with `flats`. Flat keys default to flats and other keys to sharps.
 */
export function spell(note: number, key: KeySignature = { fifths: 0 }, flats = key.fifths < 0): Pitch {
    const octave = Math.floor(note / 12) - 1;
    const pitchClass = mod(note, 12);
    // The key's own spelling may cross into the next octave, as with C♭ or B♯
    for (const letter of LETTERS) {
        const alter = keyAlter(letter, key);
        const pitch = { letter, alter, octave };
        for (const candidate of [pitch, { ...pitch, octave: octave - 1 }, { ...pitch, octave: octave + 1 }]) {
            if (midi(candidate) === note) return candidate;
        }
    }
    const natural = NATURALS.indexOf(pitchClass);
    if (natural !== -1) return { letter: LETTERS[natural]!, alter: 0, octave };
    const below = LETTERS[NATURALS.indexOf(pitchClass - 1)]!;
    const above = LETTERS[NATURALS.indexOf(pitchClass + 1)]!;
    return flats ? { letter: above, alter: -1, octave } : { letter: below, alter: 1, octave };
}

/**
 * Moves by half steps. An octave keeps the spelling; anything else lands on a natural if it
 * can, and otherwise is spelled the way it moved: a sharp going up, a flat going down.
 * Undefined past MIDI's range.
 */
export function transpose(pitch: Pitch, semitones: number): Pitch | undefined {
    const target = midi(pitch) + semitones;
    if (target < LOWEST_MIDI || target > HIGHEST_MIDI) return undefined;
    if (semitones % 12 === 0) return { ...pitch, octave: pitch.octave + semitones / 12 };
    return spell(target, { fifths: 0 }, semitones < 0);
}

/**
 * Steps through the key's scale by letter: positive goes up. From a note the key doesn't have,
 * the first step lands on the key's own version of its letter, if that's the way it's going.
 * Stops at the ends of MIDI's range.
 */
export function scaleStep(pitch: Pitch, key: KeySignature, steps: number): Pitch {
    const direction = Math.sign(steps);
    let current = pitch;
    for (let remaining = Math.abs(steps); remaining > 0; remaining--) {
        let next = { ...current, alter: keyAlter(current.letter, key) };
        // The next letter can sound the same, as C does after B♯, so keep going until it moves
        while ((midi(next) - midi(current)) * direction <= 0) next = letterAt(next, direction, key);
        if (midi(next) < LOWEST_MIDI || midi(next) > HIGHEST_MIDI) break;
        current = next;
    }
    return current;
}

export const samePitch = (a: Pitch, b: Pitch) => a.letter === b.letter && a.alter === b.alter && a.octave === b.octave;

/** Lowest sounding first; between enharmonics, the lower letter first */
export const comparePitch = (a: Pitch, b: Pitch) =>
    midi(a) - midi(b) || a.octave * 7 + LETTERS.indexOf(a.letter) - (b.octave * 7 + LETTERS.indexOf(b.letter));

/** `C4`, `F#3`, `Bb5`, `Ebb2`: sharps as `#`, flats as `b` */
export function pitchName({ letter, alter, octave }: Pitch): string {
    return `${letter}${(alter > 0 ? '#' : 'b').repeat(Math.abs(alter))}${octave}`;
}

/** Reads a name like `pitchName` writes, or undefined if it isn't one or is past MIDI's range */
export function parsePitch(name: string): Pitch | undefined {
    const match = /^([A-G])(#{0,2}|b{0,2})(-?\d+)$/.exec(name);
    if (!match) return undefined;
    const accidentals = match[2]!;
    const pitch: Pitch = {
        letter: match[1] as Letter,
        alter: accidentals.startsWith('b') ? -accidentals.length : accidentals.length,
        octave: Number(match[3]),
    };
    return midi(pitch) >= LOWEST_MIDI && midi(pitch) <= HIGHEST_MIDI ? pitch : undefined;
}

/** Like `parsePitch`, for names known to be good, as in tests */
export function pitch(name: string): Pitch {
    const parsed = parsePitch(name);
    if (!parsed) throw new Error(`Not a pitch: ${name}`);
    return parsed;
}

/**
 * Reads MuseScore's tonal pitch class, its place on the line of fifths (14 is C, 15 G, 13 F,
 * 21 C♯, 7 C♭), with the MIDI note for the octave. Undefined if they don't agree.
 */
export function fromTpc(tpc: number, note: number): Pitch | undefined {
    const fromF = tpc - 13;
    const letter = SHARP_ORDER[mod(fromF, 7)]!;
    const alter = Math.floor(fromF / 7);
    if (Math.abs(alter) > MAX_ALTER) return undefined;
    const octave = Math.round((note - NATURALS[LETTERS.indexOf(letter)]! - alter) / 12) - 1;
    const pitch = { letter, alter, octave };
    return midi(pitch) === note ? pitch : undefined;
}
