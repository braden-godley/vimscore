/**
 * Music as one stream across barlines, for edits that move it around: cutting a stretch out of
 * it, and laying it back out in measures. Times here are in whole notes from the stream's start.
 */

import { Composition } from '../composition/Composition';
import { Duration, durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, eventsLength } from '../event/Event';
import { Fraction, ZERO, add, compare, sub } from '../fraction/Fraction';
import { resolveMeasures } from '../measure/Measure';
import { mergeRests } from './Edit';
import { notePiece } from '../note/Note';

export const rests = (durations: Duration[]): Rest[] => durations.map((duration) => ({ kind: 'rest', duration }));

/** Splits a chord or rest into pieces with these values; a chord's pieces are tied together */
export function pieces(event: Chord | Rest, durations: Duration[], keepTie = true): (Chord | Rest)[] {
    return durations.map((duration, i) => {
        if (event.kind === 'rest') return { kind: 'rest', duration };
        const last = i === durations.length - 1;
        const notes = event.notes.map((note) => {
            const piece = notePiece(note, i === 0, last);
            if (!last || keepTie) return piece;
            const { tie: _, glissando: __, ...untied } = piece;
            return untied;
        });
        // It's rolled where it's struck, not where it's held on; a slur runs over every piece
        return {
            kind: 'chord',
            duration,
            notes,
            ...(i === 0 && event.arpeggio && { arpeggio: true }),
            ...(event.slur && { slur: true }),
        };
    });
}

/** Voice 0 of a part across measures `first`..`last`, with rests where the voice is missing */
export function voiceStream(composition: Composition, part: number, first: number, last: number): Event[] {
    const resolved = resolveMeasures(composition.measures);
    const result: Event[] = [];
    for (let m = first; m <= last; m++) {
        const events = composition.parts[part]?.measures[m]?.voices[0]?.events;
        result.push(...(events ?? rests(durationsFilling(resolved[m]?.length ?? ZERO))));
    }
    return result;
}

/**
 * The stretch of a stream from `start` to `end`, as events of exactly that length. What's
 * wholly inside is kept. A chord that starts inside but runs past the end is cut short; time
 * covered by something that started before is rest. A tuplet only partly inside can't be cut:
 * that time becomes rest, or with `strict` the whole thing is refused.
 */
export function extractSpan(events: Event[], start: Fraction, end: Fraction, strict = false): Event[] | undefined {
    const result: Event[] = [];
    let position: Fraction = ZERO;
    for (const event of events) {
        const eventStart = position;
        const eventEnd = add(position, eventsLength([event]));
        position = eventEnd;

        const from = compare(eventStart, start) > 0 ? eventStart : start;
        const to = compare(eventEnd, end) < 0 ? eventEnd : end;
        if (compare(from, to) >= 0) continue;
        if (compare(from, eventStart) === 0 && compare(to, eventEnd) === 0) {
            result.push(event);
            continue;
        }

        try {
            const length = sub(to, from);
            if (event.kind === 'tuplet') {
                if (strict) return undefined;
                result.push(...rests(restsFilling(sub(from, start), length)));
            } else if (compare(from, eventStart) > 0) {
                result.push(...rests(restsFilling(sub(from, start), length)));
            } else {
                // Cut off at the end, so it no longer ties or slides on to what came next
                result.push(...pieces(event, durationsFilling(length), false));
            }
        } catch {
            return undefined;
        }
    }
    return result;
}

/**
 * Lays events out in measures, measure `i` being `lengthOf(i)` long. A chord or rest crossing a
 * barline is split there, tied if it's a chord; the last measure is filled out with rests. A
 * tuplet can't be split, so one that doesn't fit moves to the next measure, rests before it,
 * unless `strict`, which refuses instead (as it does lengths no note values can write).
 */
export function cutIntoMeasures(events: Event[], lengthOf: (index: number) => Fraction, strict = false): Event[][] | undefined {
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
        const length = lengthOf(measures.length);
        const size = eventsLength([event]);
        const room = sub(length, used);

        if (compare(size, room) <= 0 || (!strict && current.length === 0 && event.kind === 'tuplet')) {
            // A tuplet longer than a whole measure overfills one rather than vanish
            current.push(event);
            used = add(used, size);
            if (compare(used, length) >= 0) close();
            continue;
        }
        if (strict && event.kind === 'tuplet') return undefined;

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
            if (strict) return undefined;
            // Leave the event whole and overfill the measure
            current.push(event);
        }
        close();
    }

    if (current.length > 0) {
        const length = lengthOf(measures.length);
        current.push(...rests(restsFilling(used, sub(length, used))));
        close();
    }
    return measures;
}
