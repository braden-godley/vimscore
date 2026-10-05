import { Composition } from '../composition/Composition';
import { leaves } from '../event/Event';
import { ZERO, add, toNumber } from '../fraction/Fraction';
import { resolveMeasures, secondsPerWholeNote } from '../measure/Measure';

/** A note as it sounds, in seconds from the start of the composition */
export interface TimedNote {
    pitch: number;
    start: number;
    duration: number;
}

/**
 * Resolves a composition into the notes it plays, sorted by start time. Tied notes are merged
 * into one, and staccato notes sound for half their written length.
 */
export function timeline(composition: Composition): TimedNote[] {
    const measures = resolveMeasures(composition.measures);
    const notes: TimedNote[] = [];

    for (const part of composition.parts) {
        // Per voice index, notes from the previous chord that are tied into the next one
        const tiedByVoice = new Map<number, Map<number, TimedNote>>();

        part.measures.forEach((partMeasure, measureIndex) => {
            const measure = measures[measureIndex];
            if (!measure) throw new Error(`Part "${part.name}" has more measures than the composition`);
            const secondsPerWhole = secondsPerWholeNote(measure.tempo);

            partMeasure.voices.forEach((voice, voiceIndex) => {
                let offset = ZERO;

                for (const { event, length } of leaves(voice.events)) {
                    const start = measure.startSeconds + toNumber(offset) * secondsPerWhole;
                    const seconds = toNumber(length) * secondsPerWhole;
                    const tiedIn = tiedByVoice.get(voiceIndex);
                    const tiedOut = new Map<number, TimedNote>();

                    if (event.kind === 'chord') {
                        for (const note of event.notes) {
                            let timed = tiedIn?.get(note.pitch);
                            if (!timed) {
                                timed = { pitch: note.pitch, start, duration: 0 };
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
