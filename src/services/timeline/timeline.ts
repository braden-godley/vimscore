import { Composition } from '../composition/Composition';
import { leaves } from '../event/Event';
import { Fraction, ZERO, add, compare, sub, toNumber } from '../fraction/Fraction';
import { DEFAULT_VOLUME, HAIRPIN_STEP, HairpinKind, ResolvedMeasure, resolveMeasures, secondsPerWholeNote } from '../measure/Measure';
import { Part } from '../part/Part';
import { performance } from './performance';
import { midi } from '../pitch/Pitch';

/** A note as it sounds, in seconds from the start of the composition */
export interface TimedNote {
    /** Index of the part playing it */
    part: number;
    pitch: number;
    start: number;
    duration: number;
    /** 0 to 1, from the part's volume markings and hairpins */
    volume: number;
}

/** A volume marking, or a hairpin from `time` to `end` */
type VolumeChange = { time: Fraction; percent: number } | { time: Fraction; end: Fraction; kind: HairpinKind; percent?: number };

/**
 * A part's volume markings and hairpins in order, by time from the start of the composition. A
 * hairpin without a volume of its own aims for a marking right at its end, if there is one.
 */
function volumeChanges(part: Part, measures: ResolvedMeasure[]): VolumeChange[] {
    const marks = part.measures.flatMap((partMeasure, m) =>
        (partMeasure.volumes ?? []).map(({ offset, percent }) => ({ time: add(measures[m]!.start, offset), percent })),
    );
    const hairpins = part.measures.flatMap((partMeasure, m) =>
        (partMeasure.hairpins ?? []).map(({ offset, length, kind, percent }) => {
            const time = add(measures[m]!.start, offset);
            const end = add(time, length);
            return { time, end, kind, percent: percent ?? marks.find((mark) => compare(mark.time, end) === 0)?.percent };
        }),
    );
    // A hairpin starting on a marking starts from it
    return [...marks, ...hairpins].sort((a, b) => compare(a.time, b.time) || Number('end' in a) - Number('end' in b));
}

/**
 * The volume in effect at a time: the last marking at or before it, or partway along a hairpin.
 * A hairpin goes from wherever the volume was when it started; a marking inside one cuts it short.
 */
function volumeAt(changes: VolumeChange[], time: Fraction): number {
    let percent = DEFAULT_VOLUME;
    for (const change of changes) {
        if (compare(change.time, time) > 0) break;
        if (!('end' in change)) {
            percent = change.percent;
            continue;
        }
        const step = change.kind === 'crescendo' ? HAIRPIN_STEP : -HAIRPIN_STEP;
        const target = change.percent ?? Math.max(0, Math.min(100, percent + step));
        const length = toNumber(sub(change.end, change.time));
        const progress = length > 0 ? Math.min(1, toNumber(sub(time, change.time)) / length) : 1;
        percent += (target - percent) * progress;
    }
    return percent / 100;
}

/** Seconds between the notes of a rolled chord */
export const ARPEGGIO_STEP = 0.05;

/** A roll takes at most half its chord, so a fast one still lands every note before the next */
function arpeggioStep(notes: number, seconds: number): number {
    return notes < 2 ? 0 : Math.min(ARPEGGIO_STEP, seconds / 2 / (notes - 1));
}

/**
 * Resolves a composition into the notes it plays, sorted by start time, playing repeats. Tied
 * notes are merged into one, staccato notes sound for half their written length, and an arpeggio's
 * notes come in one after another from the bottom, all ending together.
 */
export function timeline(composition: Composition): TimedNote[] {
    const measures = resolveMeasures(composition.measures);
    const played = performance(composition);
    const notes: TimedNote[] = [];

    for (const [partIndex, part] of composition.parts.entries()) {
        const volumes = volumeChanges(part, measures);
        // Per voice index, notes from the previous chord that are tied into the next one
        const tiedByVoice = new Map<number, Map<number, TimedNote>>();

        if (part.measures.length > measures.length) {
            throw new Error(`Part "${part.name}" has more measures than the composition`);
        }

        // In the order the measures are played, repeats and all
        played.forEach(({ measure: measureIndex, startSeconds }, i) => {
            const measure = measures[measureIndex]!;
            const partMeasure = part.measures[measureIndex];
            if (!partMeasure) return;
            const secondsPerWhole = secondsPerWholeNote(measure.tempo);
            // A tie doesn't carry back over a repeat to the start of the section
            if (i > 0 && played[i - 1]!.measure !== measureIndex - 1) tiedByVoice.clear();

            partMeasure.voices.forEach((voice, voiceIndex) => {
                let offset = ZERO;

                for (const { event, length } of leaves(voice.events)) {
                    const start = startSeconds + toNumber(offset) * secondsPerWhole;
                    const seconds = toNumber(length) * secondsPerWhole;
                    const tiedIn = tiedByVoice.get(voiceIndex);
                    const tiedOut = new Map<number, TimedNote>();

                    if (event.kind === 'chord') {
                        // An arpeggio rolls up through the notes it strikes; held ties are already sounding
                        const struck = event.notes.map(({ pitch }) => midi(pitch)).filter((pitch) => !tiedIn?.has(pitch));
                        struck.sort((a, b) => a - b);
                        const step = event.arpeggio ? arpeggioStep(struck.length, seconds) : 0;

                        for (const note of event.notes) {
                            const pitch = midi(note.pitch);
                            let timed = tiedIn?.get(pitch);
                            if (!timed) {
                                const volume = volumeAt(volumes, add(measure.start, offset));
                                const delay = struck.indexOf(pitch) * step;
                                timed = { part: partIndex, pitch, start: start + delay, duration: 0, volume };
                                notes.push(timed);
                            }
                            const end = start + (note.staccato ? seconds / 2 : seconds);
                            timed.duration = end - timed.start;
                            if (note.tie) tiedOut.set(pitch, timed);
                        }
                    }

                    tiedByVoice.set(voiceIndex, tiedOut);
                    offset = add(offset, length);
                }
            });
        });
    }

    return notes.sort((a, b) => a.start - b.start);
}
