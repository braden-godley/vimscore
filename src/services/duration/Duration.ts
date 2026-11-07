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

/**
 * Tied values for a note `length` whole notes long starting `start` into a measure (or tuplet)
 * counted in beats `beat` long, placed the way notation expects. A value starts on a multiple
 * of its own length, or on any beat, so a half can sit on the second beat of 3/4 but a quarter
 * never straddles one. A value next to one half or twice as long becomes a single dotted value
 * where that could start: a dotted quarter on the beat, or on any beat of 6/8. Throws if it
 * can't be written down exactly.
 */
export function notesFilling(start: Fraction, length: Fraction, beat: Fraction): Duration[] {
    const min = (a: Fraction, b: Fraction) => (compare(a, b) <= 0 ? a : b);
    const canStart = (position: Fraction, duration: Duration) =>
        isMultiple(position, min(durationValue({ ...duration, dots: 0 }), beat)) ||
        (compare(durationValue(duration), beat) === 0 && isMultiple(position, beat));

    const pieces: { position: Fraction; duration: Duration }[] = [];
    const end = add(start, length);
    let position = start;
    while (compare(position, end) < 0) {
        const remaining = sub(end, position);
        const next = UNDOTTED.find((duration) => compare(durationValue(duration), remaining) <= 0 && canStart(position, duration));
        if (!next) throw new RangeError(`Can't write ${length.num}/${length.den} with notes`);
        const previous = pieces.at(-1);
        const longer = previous && Math.min(previous.duration.base, next.base);
        const dotted: Duration | undefined = longer ? { base: longer as Duration['base'], dots: 1 } : undefined;
        if (
            previous &&
            dotted &&
            previous.duration.dots === 0 &&
            Math.max(previous.duration.base, next.base) === dotted.base * 2 &&
            canStart(previous.position, dotted)
        ) {
            previous.duration = dotted;
        } else pieces.push({ position, duration: next });
        position = add(position, durationValue(next));
    }
    return pieces.map(({ duration }) => duration);
}

function isMultiple(a: Fraction, b: Fraction): boolean {
    // a / b = (a.num * b.den) / (a.den * b.num)
    return (a.num * b.den) % (a.den * b.num) === 0;
}
