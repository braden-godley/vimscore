/**
 * A composition is the top-level data structure. It has the following attributes:
 * - Title
 * - Measures, holding what all parts share: time signature and tempo
 * - Parts, each holding its own contents for every measure
 * - Soundfonts, in priority order
 * - How much its eighths swing
 */

import { durationsFilling } from '../duration/Duration';
import { PIANO } from '../instrument/Instrument';
import { Rest, leaves } from '../event/Event';
import { DEFAULT_TIME_SIGNATURE, MeasureInfo, measureLength, resolveMeasures } from '../measure/Measure';
import { Part } from '../part/Part';
import { Soundfont } from '../soundfont/Soundfont';

export interface Composition {
    title: string;
    measures: MeasureInfo[];
    parts: Part[];
    /** The first one with an instrument plays it */
    soundfonts: Soundfont[];
    /** The mixer's master volume over every part, in percent (0 to 100); 100 when not set */
    volume?: number;
    /** How much eighth notes swing when played, 0 (straight) to MAX_SWING; straight when not set */
    swing?: number;
}

/** The most swing `:swing` takes */
export const MAX_SWING = 10;

/**
 * A blank score to start from: a piano's treble and bass staves, with nothing in them yet. With no
 * measures of its own it takes the defaults, 4/4 at quarter = 120 in C, and `startSession` gives
 * it its first empty measure.
 */
export function newComposition(): Composition {
    return {
        title: 'Untitled',
        measures: [],
        // A piano's two staves, named after it so choosing an instrument renames them
        parts: [
            { name: PIANO.name, clef: 'treble', program: 0, measures: [] },
            { name: PIANO.name, clef: 'bass', program: 0, measures: [] },
        ],
        soundfonts: [],
    };
}

/** True when nothing sounds in the measure: every voice of every part is rests, or empty */
function isEmptyMeasure(composition: Composition, measure: number): boolean {
    return composition.parts.every((part) =>
        (part.measures[measure]?.voices ?? []).every((voice) =>
            [...leaves(voice.events)].every(({ event }) => event.kind === 'rest'),
        ),
    );
}

/**
 * Makes sure the score ends with an empty measure to write into, adding one filled with rests
 * if needed. It keeps the last time signature. Returns the composition unchanged if it already
 * ends that way, so it's cheap to run after every edit.
 */
export function withTrailingEmptyMeasure(composition: Composition): Composition {
    const last = composition.measures.length - 1;
    if (last >= 0 && isEmptyMeasure(composition, last)) return composition;

    const timeSignature = resolveMeasures(composition.measures).at(-1)?.timeSignature ?? DEFAULT_TIME_SIGNATURE;
    const rests: Rest[] = durationsFilling(measureLength(timeSignature)).map((duration) => ({ kind: 'rest', duration }));

    return {
        ...composition,
        measures: [...composition.measures, {}],
        parts: composition.parts.map((part) => ({
            ...part,
            measures: [...part.measures, { voices: [{ events: rests.map((rest) => ({ ...rest })) }] }],
        })),
    };
}
