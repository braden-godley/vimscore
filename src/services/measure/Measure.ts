import { Duration, durationValue } from '../duration/Duration';
import { Event } from '../event/Event';
import { Fraction, ZERO, add, fraction, toNumber } from '../fraction/Fraction';

/** 6/8 is { beats: 6, beatValue: 8 } */
export interface TimeSignature {
    beats: number;
    beatValue: number;
}

/** `bpm` counts `beat`s per minute, so 6/8 can be marked as dotted quarter = 60 */
export interface Tempo {
    bpm: number;
    beat: Duration;
}

/**
 * The parts of a measure shared by every part. Each field is only set where it changes and
 * carries forward until the next change, like in a printed score.
 */
export interface MeasureInfo {
    timeSignature?: TimeSignature;
    tempo?: Tempo;
}

/** A sequence of events. Voice N continues into voice N of the next measure */
export interface Voice {
    events: Event[];
}

/** One part's contents for one measure */
export interface PartMeasure {
    voices: Voice[];
}

/** Used when the first measure doesn't set its own */
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatValue: 4 };
export const DEFAULT_TEMPO: Tempo = { bpm: 120, beat: { base: 4, dots: 0 } };

/** A measure with every carried-forward value filled in and its position worked out */
export interface ResolvedMeasure {
    timeSignature: TimeSignature;
    tempo: Tempo;
    /** Start in whole notes from the beginning of the composition */
    start: Fraction;
    /** Length in whole notes */
    length: Fraction;
    /** Start in seconds from the beginning of the composition */
    startSeconds: number;
}

export function measureLength({ beats, beatValue }: TimeSignature): Fraction {
    return fraction(beats, beatValue);
}

export function secondsPerWholeNote({ bpm, beat }: Tempo): number {
    return 60 / bpm / toNumber(durationValue(beat));
}

export function resolveMeasures(measures: MeasureInfo[]): ResolvedMeasure[] {
    let timeSignature = DEFAULT_TIME_SIGNATURE;
    let tempo = DEFAULT_TEMPO;
    let start = ZERO;
    let startSeconds = 0;

    return measures.map((info) => {
        timeSignature = info.timeSignature ?? timeSignature;
        tempo = info.tempo ?? tempo;
        const length = measureLength(timeSignature);
        const resolved = { timeSignature, tempo, start, length, startSeconds };

        start = add(start, length);
        startSeconds += toNumber(length) * secondsPerWholeNote(tempo);
        return resolved;
    });
}

/** Index of the measure sounding at `seconds`, clamped to the first and last measure */
export function measureAtTime(measures: ResolvedMeasure[], seconds: number): number {
    let index = 0;
    while (index + 1 < measures.length && measures[index + 1]!.startSeconds <= seconds) index++;
    return index;
}
