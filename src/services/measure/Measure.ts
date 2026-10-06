import { Duration, durationValue } from '../duration/Duration';
import { Event } from '../event/Event';
import { Fraction, ZERO, add, fraction, toNumber } from '../fraction/Fraction';
import { C_MAJOR, KeySignature } from '../key/KeySignature';

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
    keySignature?: KeySignature;
    /** A repeated section starts here, at a repeat barline */
    repeatStart?: boolean;
    /** A repeated section ends here: it plays once more, then goes on */
    repeatEnd?: boolean;
}

/** A sequence of events. Voice N continues into voice N of the next measure */
export interface Voice {
    events: Event[];
}

/**
 * A volume marking, like a dynamic: the part plays at this volume from here until the next
 * one. Kept by time rather than on a note, so editing the notes doesn't move or lose it.
 */
export interface VolumeMark {
    /** Whole notes from the start of the measure */
    offset: Fraction;
    /** 0 to 100 */
    percent: number;
}

/** One part's contents for one measure */
export interface PartMeasure {
    voices: Voice[];
    /** In time order, at most one at an offset */
    volumes?: VolumeMark[];
}

/** How loud a part plays before its first volume marking, about as loud as mezzo-forte */
export const DEFAULT_VOLUME = 80;

/** Used when the first measure doesn't set its own */
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatValue: 4 };
export const DEFAULT_TEMPO: Tempo = { bpm: 120, beat: { base: 4, dots: 0 } };

/** A measure with every carried-forward value filled in and its position worked out */
export interface ResolvedMeasure {
    timeSignature: TimeSignature;
    tempo: Tempo;
    keySignature: KeySignature;
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
    let keySignature = C_MAJOR;
    let start = ZERO;
    let startSeconds = 0;

    return measures.map((info) => {
        timeSignature = info.timeSignature ?? timeSignature;
        tempo = info.tempo ?? tempo;
        keySignature = info.keySignature ?? keySignature;
        const length = measureLength(timeSignature);
        const resolved = { timeSignature, tempo, keySignature, start, length, startSeconds };

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
