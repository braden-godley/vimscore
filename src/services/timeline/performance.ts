/**
 * The order measures are played in, with repeats: the first time through a repeat end, playback
 * goes back to where the section started and plays it once more, then carries on past it. A
 * section starts at the nearest repeat start before its end, or, with none, just after the
 * previous repeat end (or at the beginning).
 */

import { Composition } from '../composition/Composition';
import { MeasureInfo, resolveMeasures, secondsPerWholeNote } from '../measure/Measure';

/** One measure as it's played, with when */
export interface PlayedMeasure {
    measure: number;
    startSeconds: number;
    seconds: number;
}

export function performanceOrder(measures: MeasureInfo[]): number[] {
    const order: number[] = [];
    const repeated = new Set<number>();
    let sectionStart = 0;
    let m = 0;
    while (m < measures.length) {
        if (measures[m]!.repeatStart) sectionStart = m;
        order.push(m);
        if (measures[m]!.repeatEnd && !repeated.has(m)) {
            repeated.add(m);
            m = sectionStart;
            continue;
        }
        if (measures[m]!.repeatEnd) sectionStart = m + 1;
        m++;
    }
    return order;
}

/** Every measure as it's played, in order, with its start in seconds */
export function performance(composition: Composition): PlayedMeasure[] {
    const resolved = resolveMeasures(composition.measures);
    let startSeconds = 0;
    return performanceOrder(composition.measures).map((measure) => {
        const { length, tempo } = resolved[measure]!;
        const seconds = (length.num / length.den) * secondsPerWholeNote(tempo);
        const played = { measure, startSeconds, seconds };
        startSeconds += seconds;
        return played;
    });
}

/** Which played measure is sounding at a time, clamped to the first and last */
export function playedMeasureAt(played: PlayedMeasure[], seconds: number): PlayedMeasure | undefined {
    let index = 0;
    while (index + 1 < played.length && played[index + 1]!.startSeconds <= seconds) index++;
    return played[index];
}
