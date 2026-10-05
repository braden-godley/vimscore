/**
 * An exact rational number, used for musical time (in whole notes) so tuplets never round.
 * Always reduced, with a positive denominator, so equal fractions are structurally equal.
 */
export interface Fraction {
    readonly num: number;
    readonly den: number;
}

function gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
}

export function fraction(num: number, den = 1): Fraction {
    if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0) {
        throw new RangeError(`Invalid fraction ${num}/${den}`);
    }
    const divisor = gcd(num, den) * Math.sign(den);
    // `|| 0` turns -0 into 0 so zero has one representation
    return { num: num / divisor || 0, den: den / divisor };
}

export const ZERO = fraction(0);
export const ONE = fraction(1);

export function add(a: Fraction, b: Fraction): Fraction {
    return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Fraction, b: Fraction): Fraction {
    return fraction(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Fraction, b: Fraction): Fraction {
    return fraction(a.num * b.num, a.den * b.den);
}

/** Negative if a < b, zero if equal, positive if a > b */
export function compare(a: Fraction, b: Fraction): number {
    return a.num * b.den - b.num * a.den;
}

export function toNumber(f: Fraction): number {
    return f.num / f.den;
}
