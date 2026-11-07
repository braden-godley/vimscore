import { describe, expect, it } from 'vitest';
import { fraction } from '../fraction/Fraction';
import { Duration, notesFilling } from './Duration';

const d = (base: Duration['base'], dots: Duration['dots'] = 0): Duration => ({ base, dots });
const quarterBeat = fraction(1, 4);

describe('notesFilling', () => {
    it('takes dotted values where they can start', () => {
        expect(notesFilling(fraction(0), fraction(3, 8), quarterBeat)).toEqual([d(4, 1)]);
        expect(notesFilling(fraction(0), fraction(3, 4), quarterBeat)).toEqual([d(2, 1)]);
        // After an eighth, a quarter and an eighth rather than a dotted quarter across the beat
        expect(notesFilling(fraction(1, 8), fraction(3, 8), quarterBeat)).toEqual([d(8), d(4)]);
    });

    it('starts a long value on any beat, but never lets a short one straddle one', () => {
        // A half on the second beat of 3/4
        expect(notesFilling(fraction(1, 4), fraction(1, 2), quarterBeat)).toEqual([d(2)]);
        expect(notesFilling(fraction(3, 16), fraction(1, 8), quarterBeat)).toEqual([d(16), d(16)]);
    });

    it('takes a dotted quarter on any beat of 6/8', () => {
        expect(notesFilling(fraction(3, 8), fraction(3, 8), fraction(3, 8))).toEqual([d(4, 1)]);
        expect(notesFilling(fraction(3, 8), fraction(3, 8), quarterBeat)).toEqual([d(8), d(4)]);
    });
});
