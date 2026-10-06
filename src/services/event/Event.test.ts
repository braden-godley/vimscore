import { describe, expect, it } from 'vitest';
import { Duration, durationValue, durationsFilling, restsFilling } from '../duration/Duration';
import { fraction } from '../fraction/Fraction';
import { Event, eventsLength, leaves } from './Event';
import { spell } from '../pitch/Pitch';

const note = (base: Duration['base'], dots: Duration['dots'] = 0): Event => ({
    kind: 'chord',
    duration: { base, dots },
    notes: [{ pitch: spell(60) }],
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

describe('durationsFilling', () => {
    const fill = (num: number, den: number) => durationsFilling(fraction(num, den));

    it('uses one value where it can', () => {
        expect(fill(1, 1)).toEqual([{ base: 1, dots: 0 }]);
        expect(fill(3, 4)).toEqual([{ base: 2, dots: 1 }]);
        expect(fill(7, 8)).toEqual([{ base: 2, dots: 2 }]);
    });

    it('splits lengths no single value covers', () => {
        expect(fill(5, 4)).toEqual([{ base: 1, dots: 0 }, { base: 4, dots: 0 }]);
        expect(fill(9, 8)).toEqual([{ base: 1, dots: 0 }, { base: 8, dots: 0 }]);
    });

    it('rejects lengths that note values cannot reach', () => {
        expect(() => fill(1, 3)).toThrow(RangeError);
    });
});

describe('restsFilling', () => {
    const bases = (start: [number, number], length: [number, number]) =>
        restsFilling(fraction(...start), fraction(...length)).map(({ base }) => base);

    it('lays rests on the beat, short ones first when starting off it', () => {
        expect(bases([1, 8], [7, 8])).toEqual([8, 4, 2]);
        expect(bases([0, 1], [3, 4])).toEqual([2, 4]);
        expect(bases([3, 8], [1, 8])).toEqual([8]);
    });

    it('throws for lengths rests cannot write', () => {
        expect(() => restsFilling(fraction(0), fraction(1, 3))).toThrow(RangeError);
    });
});
