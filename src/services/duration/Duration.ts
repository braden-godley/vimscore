import { Fraction, fraction } from '../fraction/Fraction';

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
