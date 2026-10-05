import { Fraction, ZERO, add, compare, fraction, sub } from '../fraction/Fraction';

/** A written note value, before any tuplet scaling */
export interface Duration {
    /** 1 is a whole note, 4 a quarter, 64 a 64th */
    base: 1 | 2 | 4 | 8 | 16 | 32 | 64;
    /** Each dot adds half of the previous addition: 1 dot is 1.5x, 2 dots 1.75x */
    dots: 0 | 1 | 2;
}

/** Length in whole notes: (1/base) * (2 - 1/2^dots) */
export function durationValue({ base, dots }: Duration): Fraction {
    return fraction(2 ** (dots + 1) - 1, base * 2 ** dots);
}

/** Every written value, longest first */
const ALL_DURATIONS: Duration[] = ([1, 2, 4, 8, 16, 32, 64] as const)
    .flatMap((base) => ([2, 1, 0] as const).map((dots) => ({ base, dots })))
    .sort((a, b) => compare(durationValue(b), durationValue(a)));

const UNDOTTED = ALL_DURATIONS.filter(({ dots }) => dots === 0);

/**
 * The fewest values, longest first, that add up to `length` whole notes, like a dotted half for
 * 3/4 or a whole and a quarter for 5/4. Throws if it can't be written down exactly.
 */
export function durationsFilling(length: Fraction): Duration[] {
    const durations: Duration[] = [];
    let remaining = length;
    while (compare(remaining, ZERO) > 0) {
        const next = ALL_DURATIONS.find((duration) => compare(durationValue(duration), remaining) <= 0);
        if (!next) throw new RangeError(`Can't write ${length.num}/${length.den} with note values`);
        durations.push(next);
        remaining = sub(remaining, durationValue(next));
    }
    return durations;
}

/**
 * Rests for `length` whole notes starting `start` into a measure (or tuplet), placed the way
 * notation expects: each as long as possible while starting on a multiple of its own length.
 * After an eighth in 4/4 that's an eighth, a quarter, then a half, never a half straddling the
 * middle of the bar. Throws if it can't be written down exactly.
 */
export function restsFilling(start: Fraction, length: Fraction): Duration[] {
    const durations: Duration[] = [];
    const end = add(start, length);
    let position = start;
    while (compare(position, end) < 0) {
        const remaining = sub(end, position);
        const next = UNDOTTED.find((duration) => {
            const value = durationValue(duration);
            return compare(value, remaining) <= 0 && isMultiple(position, value);
        });
        if (!next) throw new RangeError(`Can't write ${length.num}/${length.den} with rests`);
        durations.push(next);
        position = add(position, durationValue(next));
    }
    return durations;
}

function isMultiple(a: Fraction, b: Fraction): boolean {
    // a / b = (a.num * b.den) / (a.den * b.num)
    return (a.num * b.den) % (a.den * b.num) === 0;
}
