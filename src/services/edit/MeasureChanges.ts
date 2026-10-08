/**
 * Changes to what every part shares at a measure: its time signature, key signature and tempo.
 * Each one carries on until the next measure that sets its own, like in a printed score.
 */

import { withoutRepeatedClefs } from '../clef/Clef';
import { Composition } from '../composition/Composition';
import { durationsFilling } from '../duration/Duration';
import { Event } from '../event/Event';
import { Fraction, add, compare, fraction, mul, sub } from '../fraction/Fraction';
import { KeySignature } from '../key/KeySignature';
import {
    MeasureInfo,
    PartMeasure,
    Tempo,
    TimeSignature,
    measureLength,
    resolveMeasures,
} from '../measure/Measure';
import { mergeRests } from './Edit';
import { cutIntoMeasures, rests } from './Stream';

const FIELDS = ['timeSignature', 'keySignature', 'tempo'] as const;
type Field = (typeof FIELDS)[number];

/**
 * Drops any change that repeats what's already in effect, so the score doesn't show a change
 * that isn't one. The first measure keeps what it sets.
 */
function withoutRepeats(measures: MeasureInfo[]): MeasureInfo[] {
    const resolved = resolveMeasures(measures);
    return measures.map((info, i) => {
        const before = resolved[i - 1];
        if (!before) return info;
        const tidied = { ...info };
        for (const field of FIELDS) {
            if (JSON.stringify(info[field]) === JSON.stringify(before[field])) delete tidied[field];
        }
        return tidied;
    });
}

function withField<F extends Field>(composition: Composition, measure: number, field: F, value: MeasureInfo[F]): Composition {
    const measures = composition.measures.map((info, i) => (i === measure ? { ...info, [field]: value } : info));
    return { ...composition, measures: withoutRepeats(measures) };
}

export function setKeySignature(composition: Composition, measure: number, keySignature: KeySignature): Composition {
    return withField(composition, measure, 'keySignature', keySignature);
}

export function setTempo(composition: Composition, measure: number, tempo: Tempo): Composition {
    return withField(composition, measure, 'tempo', tempo);
}

/**
 * Moves dynamic markings or hairpins to the measures their moment falls in after re-barring, so
 * they stay with the music. A hairpin keeps its length, running on over the new barlines.
 */
function rebarMarks<T extends { offset: Fraction }>(
    marks: (T[] | undefined)[],
    oldLength: Fraction,
    newLength: Fraction,
    count: number,
): T[][] {
    const result: T[][] = Array.from({ length: count }, () => []);
    marks.forEach((measureMarks, i) => {
        for (const mark of measureMarks ?? []) {
            const time = add(mul(oldLength, fraction(i)), mark.offset);
            const measures = Math.floor((time.num * newLength.den) / (time.den * newLength.num));
            const index = Math.min(count - 1, measures);
            result[index]!.push({ ...mark, offset: sub(time, mul(newLength, fraction(index))) });
        }
    });
    return result;
}

/**
 * Changes the time signature from a measure until the next one that sets its own, re-barring
 * the music in that stretch to the new length: nothing is lost, notes crossing the new
 * barlines are tied over, and the last measure is filled out with rests. Tempo and key changes
 * in the stretch stay with the music they were on.
 */
export function setTimeSignature(composition: Composition, measure: number, timeSignature: TimeSignature): Composition {
    const { measures: infos } = composition;
    const resolved = resolveMeasures(infos);
    const old = resolved[measure];
    if (!old) return composition;

    let end = measure + 1;
    while (end < infos.length && infos[end]!.timeSignature === undefined) end++;
    const oldLength = old.length;
    const newLength = measureLength(timeSignature);

    // Every voice of every part, as one stream across the stretch
    const flows = composition.parts.map((part) => {
        const stretch = part.measures.slice(measure, end);
        const voiceCount = Math.max(1, ...stretch.map((partMeasure) => partMeasure.voices.length));
        return Array.from({ length: voiceCount }, (_, v) =>
            cutIntoMeasures(
                stretch.flatMap((partMeasure) => partMeasure.voices[v]?.events ?? rests(durationsFilling(oldLength))),
                () => newLength,
            )!,
        );
    });
    // A last measure that only exists to hold the end of the rests, in every part, isn't kept:
    // an empty 4/4 measure becomes one 3/4 measure, not two
    const fullCount = Math.max(...flows.flat().map((cut) => cut.length));
    const onlyRests = (events: Event[] | undefined) => !events || events.every(({ kind }) => kind === 'rest');
    const spilled =
        fullCount > 1 &&
        // Longer than the music it holds, so the last measure was filled out
        compare(mul(newLength, fraction(fullCount)), mul(oldLength, fraction(end - measure))) > 0 &&
        flows.flat().every((cut) => onlyRests(cut[fullCount - 1]));
    const count = spilled ? fullCount - 1 : fullCount;
    const emptyMeasure = () => mergeRests(rests(durationsFilling(newLength)));

    // Tempo and key changes move to the measure their moment now falls in
    const stretchInfos: MeasureInfo[] = Array.from({ length: count }, () => ({}));
    const measureAt = (time: Fraction) =>
        Math.min(count - 1, Math.floor((time.num * newLength.den) / (time.den * newLength.num)));
    for (let i = measure; i < end; i++) {
        const { timeSignature: _, repeatEnd, ...carried } = infos[i]!;
        const target = measureAt(mul(oldLength, fraction(i - measure)));
        stretchInfos[target] = { ...stretchInfos[target], ...carried };
        // A repeat end goes with the end of its measure: the measure holding its last moment
        if (repeatEnd) {
            const time = mul(oldLength, fraction(i - measure + 1));
            // The last measure starting before that moment: ceil(time / newLength) - 1
            const last = Math.floor((time.num * newLength.den - 1) / (time.den * newLength.num));
            stretchInfos[Math.max(0, Math.min(count - 1, last))]!.repeatEnd = true;
        }
    }
    stretchInfos[0] = { ...stretchInfos[0], timeSignature };

    const edited: Composition = {
        ...composition,
        measures: [...infos.slice(0, measure), ...stretchInfos, ...infos.slice(end)],
        parts: composition.parts.map((part, p) => {
            const stretch = part.measures.slice(measure, end);
            const dynamics = rebarMarks(stretch.map((m) => m.dynamics), oldLength, newLength, count);
            const hairpins = rebarMarks(stretch.map((m) => m.hairpins), oldLength, newLength, count);
            const newMeasures: PartMeasure[] = Array.from({ length: count }, (_, i) => ({
                voices: flows[p]!.map((cut) => ({ events: cut[i] ?? emptyMeasure() })),
                ...(dynamics[i]!.length > 0 && { dynamics: dynamics[i] }),
                ...(hairpins[i]!.length > 0 && { hairpins: hairpins[i] }),
            }));
            // Clef changes, like tempo and key changes, go to the measure their moment falls in
            stretch.forEach(({ clef }, i) => {
                if (clef) newMeasures[measureAt(mul(oldLength, fraction(i)))]!.clef = clef;
            });
            const measures = [...part.measures.slice(0, measure), ...newMeasures, ...part.measures.slice(end)];
            return stretch.some(({ clef }) => clef) ? withoutRepeatedClefs({ ...part, measures }) : { ...part, measures };
        }),
    };
    // Also drops markings the re-barring left repeating what came before
    return withField(edited, measure, 'timeSignature', timeSignature);
}
