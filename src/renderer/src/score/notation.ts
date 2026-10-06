/** Conversions from the data model to VexFlow's string formats */

import { Duration } from '../../../services/duration/Duration';
import { KeySignature } from '../../../services/key/KeySignature';
import { ARTICULATIONS } from '../../../services/note/Note';
import { Clef } from '../../../services/part/Part';
import { Phantom } from '../../../services/phantom/Phantom';
import { Pitch } from '../../../services/pitch/Pitch';

/** A pitch as a VexFlow key like `c#/4` or `bb/3`, where c/4 is middle C */
export function pitchKey({ letter, alter, octave }: Pitch): string {
    const accidental = alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
    return `${letter.toLowerCase()}${accidental}/${octave}`;
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

/** Reads like `C♯4 dotted quarter staccato accent`, for the status bar */
export function describePhantom(phantom: Phantom): string {
    const { pitch, duration } = phantom;
    const accidental = pitch.alter > 0 ? '♯'.repeat(pitch.alter) : '♭'.repeat(-pitch.alter);
    return [
        `${pitch.letter}${accidental}${pitch.octave}`,
        ['', 'dotted ', 'double-dotted '][duration.dots] + VALUE_NAMES[duration.base],
        ...ARTICULATIONS.filter((articulation) => phantom[articulation]),
    ]
        .filter(Boolean)
        .join(' ');
}
