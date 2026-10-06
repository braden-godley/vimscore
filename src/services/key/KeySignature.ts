/**
 * A key signature, and the major scale it implies. A minor key shares its relative major's
 * notes, so the signature alone decides what's in the scale.
 */

/** Sharps (positive) or flats (negative): 2 is D major or B minor, -1 is F major or D minor */
export interface KeySignature {
    fifths: number;
}

export const C_MAJOR: KeySignature = { fifths: 0 };
