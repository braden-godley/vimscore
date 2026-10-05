/** Conversions from the data model to VexFlow's string formats */

import { Duration } from '../../../services/duration/Duration';
import { C_MAJOR, KeySignature } from '../../../services/key/KeySignature';
import { Clef } from '../../../services/part/Part';
import { Phantom } from '../../../services/phantom/Phantom';

const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

/**
 * MIDI pitch to a VexFlow key like `c#/4`, where c/4 is middle C. Black keys are spelled with
 * flats in flat keys and sharps otherwise, until the model records spelling itself.
 */
export function pitchKey(pitch: number, key: KeySignature = C_MAJOR): string {
    const names = key.fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
    return `${names[pitch % 12]}/${Math.floor(pitch / 12) - 1}`;
}

/** VexFlow's name for a key signature, by its major key: `-7` (Cb) through `7` (C#) */
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

export function keySpec({ fifths }: KeySignature): string {
    return KEY_NAMES[Math.max(-7, Math.min(7, fifths)) + 7]!;
}

const DURATION_CODES: Record<Duration['base'], string> = {
    1: 'w',
    2: 'h',
    4: 'q',
    8: '8',
    16: '16',
    32: '32',
    64: '64',
};

export function durationCode({ base }: Duration): string {
    return DURATION_CODES[base];
}

/** Where rests sit: the middle line of each clef */
export const REST_KEYS: Record<Clef, string> = {
    treble: 'b/4',
    bass: 'd/3',
};


const VALUE_NAMES: Record<Duration['base'], string> = {
    1: 'whole',
    2: 'half',
    4: 'quarter',
    8: 'eighth',
    16: '16th',
    32: '32nd',
    64: '64th',
};

/** Reads like `C♯4 dotted quarter staccato`, for the status bar, spelled for the key */
export function describePhantom({ pitch, duration, staccato }: Phantom, key: KeySignature = C_MAJOR): string {
    const [name = '', octave] = pitchKey(pitch, key).split('/');
    const spelled = name[0]!.toUpperCase() + name.slice(1).replace('#', '♯').replace('b', '♭');
    return [
        `${spelled}${octave}`,
        ['', 'dotted ', 'double-dotted '][duration.dots] + VALUE_NAMES[duration.base],
        staccato ? 'staccato' : '',
    ]
        .filter(Boolean)
        .join(' ');
}
