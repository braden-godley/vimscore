/**
 * Instruments, as soundfonts and MIDI name them: a program number in a bank, or a drum kit.
 * Without a soundfont, the 128 General MIDI programs stand in, by name.
 */

import { Clef, Part } from '../part/Part';

export interface Instrument {
    name: string;
    /** 0 to 127 */
    program: number;
    /** Soundfonts keep variations of a program in other banks; 0 is the standard one */
    bank: number;
    drums: boolean;
    /**
     * The soundfont the sound is from, by path, when it's that soundfont's in particular. Without
     * one, it's the first of the score's soundfonts that has this bank and program.
     */
    soundfont?: string;
}

/** The General MIDI names, by program number */
const GENERAL_MIDI = [
    'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
    'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
    'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
    'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica',
    'Tango Accordion',
    'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
    'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
    'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass', 'Slap Bass 1',
    'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
    'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp',
    'Timpani',
    'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs',
    'Synth Voice', 'Orchestra Hit',
    'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1',
    'Synth Brass 2',
    'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
    'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
    'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)',
    'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
    'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)',
    'Pad 7 (halo)', 'Pad 8 (sweep)',
    'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)',
    'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
    'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
    'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum',
    'Reverse Cymbal',
    'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause',
    'Gunshot',
];

export const GENERAL_MIDI_INSTRUMENTS: Instrument[] = GENERAL_MIDI.map((name, program) => ({
    name,
    program,
    bank: 0,
    drums: false,
}));

export const PIANO = GENERAL_MIDI_INSTRUMENTS[0]!;

/** The General MIDI name for a program, for parts saved without a soundfont's name */
export function generalMidiName(program: number): string {
    return GENERAL_MIDI[program] ?? `Program ${program}`;
}

/**
 * Programs that sit low enough to be written in bass clef: the basses, cello, timpani, trombone,
 * tuba, bassoon and baritone sax. Everything else reads treble.
 */
const BASS_CLEF_PROGRAMS = new Set([32, 33, 34, 35, 36, 37, 38, 39, 42, 43, 47, 57, 58, 67, 70]);

export function clefFor({ program, drums }: Instrument): Clef {
    return !drums && BASS_CLEF_PROGRAMS.has(program) ? 'bass' : 'treble';
}

/**
 * The instruments matching what's typed: every word must appear in the name, in any order, or
 * a number picks out a program. Matches at the start of the name come first.
 */
export function filterInstruments(instruments: Instrument[], query: string): Instrument[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return instruments;
    const matches = instruments.filter(({ name, program }) =>
        words.every((word) => name.toLowerCase().includes(word) || String(program + 1) === word),
    );
    const leading = (instrument: Instrument) => (instrument.name.toLowerCase().startsWith(words[0]!) ? 0 : 1);
    return matches.sort((a, b) => leading(a) - leading(b));
}

/** The instrument a part plays */
export function partInstrument({ program, bank, drums, soundfont }: Part): Instrument {
    return { name: generalMidiName(program), program, bank: bank ?? 0, drums: drums ?? false, ...(soundfont && { soundfont }) };
}

/** The same bank and program, whichever soundfont it's in */
export const sameSound = (a: Instrument, b: Instrument) =>
    a.program === b.program && a.bank === b.bank && a.drums === b.drums;
