/**
 * How a drum kit is written on a percussion staff: each General MIDI drum sound has its own
 * line or space and notehead, the way drum parts are usually engraved. Drums sit on lines
 * and spaces with the treble clef's names, so the snare is on C5 and the kick on F4.
 */

import { HIGHEST_MIDI, LETTERS, Pitch, midi, pitch, spell } from '../pitch/Pitch';

export type Notehead = 'normal' | 'x' | 'circle-x' | 'diamond' | 'triangle';

export interface DrumNotation {
    name: string;
    /** Where it sits on the stave */
    position: Pitch;
    notehead: Notehead;
    /** Marked with a small circle over the note, as an open hi-hat is */
    open?: boolean;
}

const drum = (name: string, position: string, notehead: Notehead = 'normal', open = false): DrumNotation => ({
    name,
    position: pitch(position),
    notehead,
    ...(open && { open }),
});

/** By MIDI note number */
const DRUMS: Record<number, DrumNotation> = {
    35: drum('Acoustic Bass Drum', 'E4'),
    36: drum('Bass Drum', 'F4'),
    37: drum('Side Stick', 'C5', 'circle-x'),
    38: drum('Acoustic Snare', 'C5'),
    39: drum('Hand Clap', 'D5', 'x'),
    40: drum('Electric Snare', 'C5', 'diamond'),
    41: drum('Low Floor Tom', 'G4'),
    42: drum('Closed Hi-Hat', 'G5', 'x'),
    43: drum('High Floor Tom', 'A4'),
    44: drum('Pedal Hi-Hat', 'D4', 'x'),
    45: drum('Low Tom', 'B4'),
    46: drum('Open Hi-Hat', 'G5', 'x', true),
    47: drum('Low-Mid Tom', 'D5'),
    48: drum('Hi-Mid Tom', 'E5'),
    49: drum('Crash Cymbal', 'A5', 'x'),
    50: drum('High Tom', 'F5'),
    51: drum('Ride Cymbal', 'F5', 'x'),
    52: drum('Chinese Cymbal', 'B5', 'circle-x'),
    53: drum('Ride Bell', 'F5', 'diamond'),
    54: drum('Tambourine', 'D5', 'triangle'),
    55: drum('Splash Cymbal', 'C6', 'x'),
    56: drum('Cowbell', 'E5', 'triangle'),
    57: drum('Crash Cymbal 2', 'B5', 'x'),
    58: drum('Vibraslap', 'C6', 'triangle'),
    59: drum('Ride Cymbal 2', 'E5', 'x'),
};

/**
 * How a pitch is written as a drum. A sound outside the kit keeps its pitch's line or space,
 * without an accidental, so it still lands somewhere on the stave.
 */
export function drumNotation(sound: Pitch): DrumNotation {
    const known = DRUMS[midi(sound)];
    if (known) return known;
    return { name: '', position: { ...sound, alter: 0 }, notehead: 'normal' };
}

/** The kit's name for a sound, or undefined if it isn't one of the kit's */
export function drumName(sound: Pitch): string | undefined {
    return DRUMS[midi(sound)]?.name;
}

/** How far up the stave a line or space is, a step for each */
const staffStep = ({ letter, octave }: Pitch) => octave * 7 + LETTERS.indexOf(letter);

/**
 * Every MIDI sound from the bottom of the stave up, as it's written on a percussion staff,
 * sounds sharing a line or space in MIDI order
 */
const BY_STAFF = Array.from({ length: HIGHEST_MIDI + 1 }, (_, sound) => ({
    sound,
    step: staffStep(drumNotation(spell(sound)).position),
})).sort((a, b) => a.step - b.step || a.sound - b.sound);

/** Just the kit's drums, in the same order */
const KIT = BY_STAFF.filter(({ sound }) => sound in DRUMS);

/** The drum where a percussion staff starts a note on a rest */
export const SNARE = spell(38);

/**
 * Moves through `sounds` up (positive) or down, stopping at the ends. From a sound not among
 * them, the first step goes to the nearest one written above or below it.
 */
function stepThrough(sounds: typeof BY_STAFF, sound: Pitch, steps: number): Pitch {
    let from = sounds.findIndex((entry) => entry.sound === midi(sound));
    if (from === -1) {
        // Just under the ones written above it, or just over the ones below
        const step = staffStep(drumNotation(sound).position);
        const below = sounds.filter((entry) => entry.step < step).length;
        const notAbove = sounds.filter((entry) => entry.step <= step).length;
        from = steps > 0 ? notAbove - 1 : below;
    }
    const to = Math.max(0, Math.min(sounds.length - 1, from + steps));
    return spell(sounds[to]!.sound);
}

/** Moves through the kit as it's written, a drum at a time: positive goes up */
export function stepKit(sound: Pitch, steps: number): Pitch {
    return stepThrough(KIT, sound, steps);
}

/**
 * Moves through every MIDI sound as it's written on a percussion staff, the kit's drums and
 * the sounds outside it, so each step stays on its line or space or moves up (positive) or
 * down from it
 */
export function stepSounds(sound: Pitch, steps: number): Pitch {
    return stepThrough(BY_STAFF, sound, steps);
}
