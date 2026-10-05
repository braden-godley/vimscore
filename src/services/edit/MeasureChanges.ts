/**
 * Changes to what every part shares at a measure: its time signature, key signature and tempo.
 * Each one carries on until the next measure that sets its own, like in a printed score.
 */

import { Composition } from '../composition/Composition';
import { durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, eventsLength } from '../event/Event';
import { Fraction, ZERO, add, compare, fraction, mul, sub } from '../fraction/Fraction';
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

const rests = (durations: ReturnType<typeof durationsFilling>): Rest[] =>
    durations.map((duration) => ({ kind: 'rest', duration }));

/** Splits a chord or rest into pieces with these values; a chord's pieces are tied together */
function pieces(event: Chord | Rest, durations: ReturnType<typeof durationsFilling>): (Chord | Rest)[] {
    return durations.map((duration, i) => {
        if (event.kind === 'rest') return { kind: 'rest', duration };
        const last = i === durations.length - 1;
        // Only the last piece keeps the note's own tie onward, and its staccato
        const notes = event.notes.map((note) => (last ? note : { pitch: note.pitch, tie: true }));
        return { kind: 'chord', duration, notes };
    });
}

/**
 * Lays events out in measures of `length`. A chord or rest crossing a barline is split there,
 * tied if it's a chord. A tuplet can't be split, so one that doesn't fit is moved to the next
 * measure, with rests before it.
 */
function cutIntoMeasures(events: Event[], length: Fraction): Event[][] {
    const measures: Event[][] = [];
    let current: Event[] = [];
    let used: Fraction = ZERO;
    const close = () => {
        measures.push(mergeRests(current));
        current = [];
        used = ZERO;
    };

    const queue = [...events];
    while (queue.length > 0) {
        const event = queue.shift()!;
        const size = eventsLength([event]);
        const room = sub(length, used);

        if (compare(size, room) <= 0 || (current.length === 0 && event.kind === 'tuplet')) {
            // A tuplet longer than a whole measure overfills one rather than vanish
            current.push(event);
            used = add(used, size);
            if (compare(used, length) >= 0) close();
            continue;
        }

        try {
            if (event.kind === 'tuplet') {
                current.push(...rests(restsFilling(used, room)));
                queue.unshift(event);
            } else {
                // Filling a whole measure takes the fewest values (a dotted half in 3/4); partway in,
                // they fall on the beat
                const head = compare(used, ZERO) === 0 ? durationsFilling(room) : restsFilling(used, room);
                const tail = durationsFilling(sub(size, room));
                const split = pieces(event, [...head, ...tail]);
                current.push(...split.slice(0, head.length));
                queue.unshift(...split.slice(head.length));
            }
        } catch {
            // Lengths no note values can write: leave the event whole and overfill the measure
            current.push(event);
        }
        close();
    }

    if (current.length > 0) {
        current.push(...rests(restsFilling(used, sub(length, used))));
        close();
    }
    return measures;
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
                newLength,
            ),
        );
    });
    const count = Math.max(...flows.flat().map((cut) => cut.length));
    const emptyMeasure = () => mergeRests(rests(durationsFilling(newLength)));

    // Tempo and key changes move to the measure their moment now falls in
    const stretchInfos: MeasureInfo[] = Array.from({ length: count }, () => ({}));
    for (let i = measure; i < end; i++) {
        const { timeSignature: _, ...carried } = infos[i]!;
        const offset = mul(oldLength, fraction(i - measure));
        const target = Math.min(count - 1, Math.floor((offset.num * newLength.den) / (offset.den * newLength.num)));
        stretchInfos[target] = { ...stretchInfos[target], ...carried };
    }
    stretchInfos[0] = { ...stretchInfos[0], timeSignature };

    const edited: Composition = {
        ...composition,
        measures: [...infos.slice(0, measure), ...stretchInfos, ...infos.slice(end)],
        parts: composition.parts.map((part, p) => {
            const newMeasures: PartMeasure[] = Array.from({ length: count }, (_, i) => ({
                voices: flows[p]!.map((cut) => ({ events: cut[i] ?? emptyMeasure() })),
            }));
            return { ...part, measures: [...part.measures.slice(0, measure), ...newMeasures, ...part.measures.slice(end)] };
        }),
    };
    // Also drops markings the re-barring left repeating what came before
    return withField(edited, measure, 'timeSignature', timeSignature);
}
