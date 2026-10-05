import { Duration } from '../duration/Duration';
import { Chord, Event, Rest, Tuplet } from '../event/Event';
import { Note } from '../note/Note';
import { Part } from '../part/Part';
import { Soundfont } from '../soundfont/Soundfont';
import { Composition } from './Composition';

function chord(duration: Duration, ...notes: (number | Note)[]): Chord {
    return {
        kind: 'chord',
        duration,
        notes: notes.map((note) => (typeof note === 'number' ? { pitch: note } : note)),
    };
}

function rest(duration: Duration): Rest {
    return { kind: 'rest', duration };
}

function tuplet(actual: number, normal: number, events: Event[]): Tuplet {
    return { kind: 'tuplet', actual, normal, events };
}

const whole: Duration = { base: 1, dots: 0 };
const dottedHalf: Duration = { base: 2, dots: 1 };
const half: Duration = { base: 2, dots: 0 };
const dottedQuarter: Duration = { base: 4, dots: 1 };
const quarter: Duration = { base: 4, dots: 0 };
const eighth: Duration = { base: 8, dots: 0 };
const sixteenth: Duration = { base: 16, dots: 0 };

const melody: Part = {
    name: 'Melody',
    program: 0,
    measures: [
        // 4/4: C major, G major, C major
        { voices: [{ events: [
            chord(quarter, 60, 64, 67),
            chord(quarter, 55, 59, 62),
            chord(half, 60, 64, 67),
        ] }] },
        // 3/4: a triplet, a quintuplet and a sextuplet, one beat each
        { voices: [{ events: [
            tuplet(3, 2, [chord(eighth, 76), chord(eighth, 74), chord(eighth, 72)]),
            tuplet(5, 4, [69, 71, 72, 74, 76].map((pitch) => chord(sixteenth, pitch))),
            tuplet(6, 4, [77, 76, 74, 72, 71, 69].map((pitch) => chord(sixteenth, pitch))),
        ] }] },
        // 6/8: a C tied over the beat, then a staccato C
        { voices: [{ events: [
            chord(dottedQuarter, { pitch: 72, tie: true }),
            chord(eighth, 72),
            chord(eighth, { pitch: 72, staccato: true }),
            rest(eighth),
        ] }] },
    ],
};

const bass: Part = {
    name: 'Bass',
    program: 0,
    measures: [
        { voices: [{ events: [chord(whole, 48)] }] },
        { voices: [{ events: [chord(dottedHalf, 43)] }] },
        { voices: [{ events: [chord(dottedHalf, 48)] }] },
    ],
};

const exampleSoundfont: Soundfont = {
    filePath: '/Users/bgodley/Documents/MuseScore3/SoundFonts/RuneScape 2.sf2',
};

export const exampleComposition: Composition = {
    title: 'Example',
    measures: [
        { timeSignature: { beats: 4, beatValue: 4 }, tempo: { bpm: 120, beat: quarter } },
        { timeSignature: { beats: 3, beatValue: 4 } },
        { timeSignature: { beats: 6, beatValue: 8 }, tempo: { bpm: 60, beat: dottedQuarter } },
    ],
    parts: [melody, bass],
    soundfont: exampleSoundfont,
};
