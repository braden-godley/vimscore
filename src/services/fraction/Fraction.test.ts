import { describe, expect, it } from 'vitest';
import { add, compare, fraction, mul, sub, toNumber } from './Fraction';

describe('fraction', () => {
    it('reduces and normalizes the sign', () => {
        expect(fraction(6, 8)).toEqual({ num: 3, den: 4 });
        expect(fraction(3, -6)).toEqual({ num: -1, den: 2 });
        expect(fraction(0, -5)).toEqual({ num: 0, den: 1 });
    });

    it('rejects non-integers and zero denominators', () => {
        expect(() => fraction(1, 0)).toThrow(RangeError);
        expect(() => fraction(0.5, 2)).toThrow(RangeError);
    });

    it('does arithmetic exactly', () => {
        const third = fraction(1, 3);
        expect(add(add(third, third), third)).toEqual(fraction(1));
        expect(sub(fraction(1, 2), third)).toEqual(fraction(1, 6));
        expect(mul(fraction(2, 3), fraction(3, 8))).toEqual(fraction(1, 4));
        expect(compare(third, fraction(1, 2))).toBeLessThan(0);
        expect(toNumber(fraction(3, 4))).toBe(0.75);
    });
});
