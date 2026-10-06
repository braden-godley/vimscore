/**
 * Events are the things that take up time in a voice. They're stored in order, back to back,
 * so an event's position is the sum of the lengths before it.
 */

import { Duration, durationValue } from '../duration/Duration';
import { Fraction, ONE, ZERO, add, fraction, mul } from '../fraction/Fraction';
import { Note } from '../note/Note';

/** One or more notes sounding together. A single note is a one-note chord */
export interface Chord {
    kind: 'chord';
    duration: Duration;
    notes: Note[];
    /** Rolled from the bottom note up, rather than struck all at once */
    arpeggio?: boolean;
}

export interface Rest {
    kind: 'rest';
    duration: Duration;
}

/**
 * Plays `actual` notes in the time of `normal`, scaling everything inside by normal/actual.
 * Triplet is 3:2, quintuplet 5:4, sextuplet 6:4. Tuplets can nest.
 */
export interface Tuplet {
    kind: 'tuplet';
    actual: number;
    normal: number;
    events: Event[];
}

export type Event = Chord | Rest | Tuplet;

/** A chord or rest with its length after all enclosing tuplets are applied */
export interface Leaf {
    event: Chord | Rest;
    length: Fraction;
}

/** Flattens tuplets away, yielding every chord and rest in order with its sounding length */
export function* leaves(events: Event[], scale: Fraction = ONE): Generator<Leaf> {
    for (const event of events) {
        if (event.kind === 'tuplet') {
            yield* leaves(event.events, mul(scale, fraction(event.normal, event.actual)));
        } else {
            yield { event, length: mul(scale, durationValue(event.duration)) };
        }
    }
}

/** Total length of the events in whole notes */
export function eventsLength(events: Event[]): Fraction {
    let total = ZERO;
    for (const { length } of leaves(events)) total = add(total, length);
    return total;
}

/** Replaces chords and rests by their index in `leaves`, keeping tuplets around them */
export function mapLeaves(events: Event[], fn: (event: Chord | Rest, index: number) => Chord | Rest): Event[] {
    let index = 0;
    const map = (events: Event[]): Event[] =>
        events.map((event) => (event.kind === 'tuplet' ? { ...event, events: map(event.events) } : fn(event, index++)));
    return map(events);
}

/**
 * Which note of the next chord the note at `index` of a chord slides to: the one as far from the
 * top, so a glissando up to a chord lands on its top note, or the bottom one if it has fewer
 */
export function glissandoTarget(index: number, from: Chord, to: Chord): number {
    const fromTop = from.notes.length - 1 - index;
    return Math.max(0, to.notes.length - 1 - fromTop);
}
