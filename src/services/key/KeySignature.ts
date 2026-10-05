/**
 * A key signature, and the major scale it implies. A minor key shares its relative major's
 * notes, so the signature alone decides what's in the scale.
 */

/** Sharps (positive) or flats (negative): 2 is D major or B minor, -1 is F major or D minor */
export interface KeySignature {
    fifths: number;
}

export const C_MAJOR: KeySignature = { fifths: 0 };

/** Semitones above the tonic of each degree of a major scale */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const LOWEST_PITCH = 0;
const HIGHEST_PITCH = 127;

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Pitch class of the major key's tonic: each sharp goes up a fifth (7 semitones) */
function tonic({ fifths }: KeySignature): number {
    return mod12(fifths * 7);
}

export function inScale(pitch: number, key: KeySignature): boolean {
    return MAJOR_SCALE.includes(mod12(pitch - tonic(key)));
}

/**
 * Steps through the key's scale: positive goes up. From a note outside the scale, the first
 * step lands on the nearest scale note in that direction. Stops at the ends of MIDI's range.
 */
export function scaleStep(pitch: number, key: KeySignature, steps: number): number {
    const direction = Math.sign(steps);
    let current = pitch;
    for (let remaining = Math.abs(steps); remaining > 0; remaining--) {
        let next = current + direction;
        while (next >= LOWEST_PITCH && next <= HIGHEST_PITCH && !inScale(next, key)) next += direction;
        if (next < LOWEST_PITCH || next > HIGHEST_PITCH) break;
        current = next;
    }
    return current;
}
