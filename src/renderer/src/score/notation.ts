/** Conversions from the data model to VexFlow's string formats */

import { Duration } from '../../../services/duration/Duration';
import { Clef } from '../../../services/part/Part';

const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/**
 * MIDI pitch to a VexFlow key like `c#/4`, where c/4 is middle C. Always spelled with sharps
 * until the model records spelling or key signatures.
 */
export function pitchKey(pitch: number): string {
    return `${PITCH_NAMES[pitch % 12]}/${Math.floor(pitch / 12) - 1}`;
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
