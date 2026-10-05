import { describe, expect, it } from 'vitest';
import { Duration, durationValue } from '../duration/Duration';
import { fraction } from '../fraction/Fraction';
import { Event, eventsLength, leaves } from './Event';

const note = (base: Duration['base'], dots: Duration['dots'] = 0): Event => ({
    kind: 'chord',
    duration: { base, dots },
    notes: [{ pitch: 60 }],
});

describe('durationValue', () => {
    it('handles plain and dotted values', () => {
        expect(durationValue({ base: 4, dots: 0 })).toEqual(fraction(1, 4));
        expect(durationValue({ base: 4, dots: 1 })).toEqual(fraction(3, 8));
        expect(durationValue({ base: 2, dots: 2 })).toEqual(fraction(7, 8));
        expect(durationValue({ base: 1, dots: 1 })).toEqual(fraction(3, 2));
    });
});

describe('eventsLength', () => {
    it('fits a triplet, quintuplet and sextuplet into one beat', () => {
        const triplet: Event = { kind: 'tuplet', actual: 3, normal: 2, events: [note(8), note(8), note(8)] };
        const quintuplet: Event = { kind: 'tuplet', actual: 5, normal: 4, events: Array(5).fill(note(16)) };
        const sextuplet: Event = { kind: 'tuplet', actual: 6, normal: 4, events: Array(6).fill(note(16)) };

        for (const tuplet of [triplet, quintuplet, sextuplet]) {
            expect(eventsLength([tuplet])).toEqual(fraction(1, 4));
        }
    });

    it('allows mixed values inside a tuplet', () => {
        const triplet: Event = { kind: 'tuplet', actual: 3, normal: 2, events: [note(4), note(8)] };
        expect(eventsLength([triplet])).toEqual(fraction(1, 4));
    });

    it('scales nested tuplets by both ratios', () => {
        const inner: Event = { kind: 'tuplet', actual: 5, normal: 4, events: Array(5).fill(note(16)) };
        const outer: Event = { kind: 'tuplet', actual: 3, normal: 2, events: [note(4), inner] };
        expect([...leaves([outer])].map(({ length }) => length)).toEqual([
            fraction(1, 6),
            ...Array(5).fill(fraction(1, 30)),
        ]);
        expect(eventsLength([outer])).toEqual(fraction(1, 3));
    });
});
