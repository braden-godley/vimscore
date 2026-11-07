/**
 * Taking whole measures out of the score, in every part. The music after them closes up, still
 * in the time signature, key, tempo, clef and dynamic it had.
 */

import { clefAt, withoutRepeatedClefs } from '../clef/Clef';
import { Composition } from '../composition/Composition';
import { Event, leaves, mapLeaves } from '../event/Event';
import { ZERO, add, compare, sub } from '../fraction/Fraction';
import { MeasureInfo, PartMeasure, ResolvedMeasure, resolveMeasures } from '../measure/Measure';
import { dynamicBefore } from './Dynamics';
import { withoutRepeats } from './MeasureChanges';

const FIELDS = ['timeSignature', 'keySignature', 'tempo'] as const;

/** Nothing ties, slurs or slides on from the last chord, as what it led into is gone */
function untiedAtEnd(events: Event[]): Event[] {
    const last = [...leaves(events)].length - 1;
    return mapLeaves(events, (event, i) => {
        if (i !== last || event.kind !== 'chord') return event;
        const { slur: _, ...chord } = event;
        return { ...chord, notes: event.notes.map(({ tie: __, glissando: ___, ...note }) => note) };
    });
}

/**
 * Measure `m` of a part with nothing carried on into measure `first`, where measures are being
 * taken out or put in: the last chord before it ties, slurs and slides into nothing, and
 * hairpins running into it end there
 */
export function endingBefore(partMeasure: PartMeasure, m: number, first: number, resolved: ResolvedMeasure[]): PartMeasure {
    if (m === first - 1) {
        const voices = partMeasure.voices.map((voice) => ({ events: untiedAtEnd(voice.events) }));
        partMeasure = { ...partMeasure, voices };
    }
    if (m < first && partMeasure.hairpins) {
        const start = resolved[m]!.start;
        const gapStart = resolved[first]!.start;
        const hairpins = partMeasure.hairpins.map((hairpin) => {
            const room = sub(gapStart, add(start, hairpin.offset));
            return compare(hairpin.length, room) > 0 ? { ...hairpin, length: room } : hairpin;
        });
        partMeasure = { ...partMeasure, hairpins };
    }
    return partMeasure;
}

/**
 * Removes measures `first` to `last` from every part, or undefined when there are none there.
 * The measure after them keeps the time signature, key, tempo, clefs and dynamics it had, so
 * changes made in the removed measures are carried on to it. Repeat barlines on them go, ties
 * and slurs into them are taken off, and hairpins running into them stop where they did.
 */
export function removeMeasures(composition: Composition, first: number, last: number): Composition | undefined {
    last = Math.min(last, composition.measures.length - 1);
    if (first < 0 || first > last) return undefined;

    const resolved = resolveMeasures(composition.measures);
    // What's in effect just before the gap, or the defaults when it starts the score
    const before: ResolvedMeasure = resolved[first - 1] ?? resolveMeasures([{}])[0]!;
    const next = last + 1;
    const kept = (_: unknown, m: number) => m < first || m > last;

    const carried = (info: MeasureInfo): MeasureInfo => {
        const after = { ...info };
        for (const field of FIELDS) {
            const value = resolved[next]![field];
            if (info[field] === undefined && JSON.stringify(value) !== JSON.stringify(before[field])) {
                Object.assign(after, { [field]: value });
            }
        }
        return after;
    };
    const measures = withoutRepeats(composition.measures.map((info, m) => (m === next ? carried(info) : info)).filter(kept));

    const parts = composition.parts.map((part, p) => {
        const clefBefore = first > 0 ? clefAt(part, first - 1) : (part.clef ?? 'treble');
        const clefAfter = clefAt(part, last);
        const dynamicThen = dynamicBefore(composition, p, first, ZERO);
        const dynamicAfter = dynamicBefore(composition, p, next, ZERO);

        const edited = part.measures.map((partMeasure, m): PartMeasure => {
            partMeasure = endingBefore(partMeasure, m, first, resolved);
            if (m === next) {
                if (partMeasure.clef === undefined && clefAfter !== clefBefore) partMeasure = { ...partMeasure, clef: clefAfter };
                const marks = partMeasure.dynamics ?? [];
                if (dynamicAfter !== dynamicThen && !marks.some((mark) => compare(mark.offset, ZERO) === 0)) {
                    partMeasure = { ...partMeasure, dynamics: [{ offset: ZERO, dynamic: dynamicAfter }, ...marks] };
                }
            }
            return partMeasure;
        });
        return withoutRepeatedClefs({ ...part, measures: edited.filter(kept) });
    });

    return { ...composition, measures, parts };
}
