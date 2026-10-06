import { Composition } from '../composition/Composition';
import { leaves } from '../event/Event';
import { Fraction, ZERO, add, compare, toNumber } from '../fraction/Fraction';
import { DEFAULT_VOLUME, ResolvedMeasure, resolveMeasures, secondsPerWholeNote } from '../measure/Measure';
import { Part } from '../part/Part';
import { performance } from './performance';

/** A note as it sounds, in seconds from the start of the composition */
export interface TimedNote {
    /** Index of the part playing it */
    part: number;
    pitch: number;
    start: number;
    duration: number;
    /** 0 to 1, from the part's volume markings */
    volume: number;
}

/** A part's volume markings in order, by time from the start of the composition */
function volumeChanges(part: Part, measures: ResolvedMeasure[]): { time: Fraction; percent: number }[] {
    return part.measures.flatMap((partMeasure, m) =>
        (partMeasure.volumes ?? []).map(({ offset, percent }) => ({ time: add(measures[m]!.start, offset), percent })),
    );
}

/** The volume in effect at a time: the last marking at or before it */
function volumeAt(changes: { time: Fraction; percent: number }[], time: Fraction): number {
    let percent = DEFAULT_VOLUME;
    for (const change of changes) {
        if (compare(change.time, time) > 0) break;
        percent = change.percent;
    }
    return percent / 100;
}

/**
 * Resolves a composition into the notes it plays, sorted by start time, playing repeats. Tied
 * notes are merged into one, and staccato notes sound for half their written length.
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
                        for (const note of event.notes) {
                            let timed = tiedIn?.get(note.pitch);
                            if (!timed) {
                                const volume = volumeAt(volumes, add(measure.start, offset));
                                timed = { part: partIndex, pitch: note.pitch, start, duration: 0, volume };
                                notes.push(timed);
                            }
                            const end = start + (note.staccato ? seconds / 2 : seconds);
                            timed.duration = end - timed.start;
                            if (note.tie) tiedOut.set(note.pitch, timed);
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
