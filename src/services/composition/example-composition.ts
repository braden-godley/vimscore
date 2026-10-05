import { Instrument } from '../instrument/Instrument';
import { Measure } from '../measure/Measure';
import { Soundfont } from '../soundfont/Soundfont';
import { Composition } from './Composition';

const exampleMeasures: Measure[] = [
    {
        notes: [
            // C major chord beat 0
            { pitch: 39, duration: 4, startsAt: 0 },
            { pitch: 43, duration: 4, startsAt: 0 },
            { pitch: 46, duration: 4, startsAt: 0 },
            // G major chord beat 1
            { pitch: 32, duration: 4, startsAt: 16 },
            { pitch: 36, duration: 4, startsAt: 16 },
            { pitch: 39, duration: 4, startsAt: 16 },
            // C major chord beat 2
            { pitch: 39, duration: 5, startsAt: 32 },
            { pitch: 43, duration: 5, startsAt: 32 },
            { pitch: 46, duration: 5, startsAt: 32 },
        ]
    }
];

const exampleInstrument: Instrument = {
    sound: 0,
    measures: exampleMeasures,
};

const exampleSoundfont: Soundfont = {
    filePath: '/Users/bgodley/Documents/MuseScore3/SoundFonts/RuneScape 2.sf2',
};

export const exampleComposition: Composition = {
    title: 'Example',
    instruments: [exampleInstrument],
    soundfont: exampleSoundfont,
};
