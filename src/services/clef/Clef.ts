/**
 * The clefs a staff can be written in. A part starts in one and can change to another at the
 * start of any measure, carrying on until the next change, like in a printed score.
 */

import type { Part } from '../part/Part';
import { Pitch, pitch } from '../pitch/Pitch';

/** In the order the clef picker lists them */
export const CLEFS = ['treble', 'bass', 'alto', 'percussion', 'treble8va', 'bass8vb'] as const;

export type Clef = (typeof CLEFS)[number];

export const CLEF_NAMES: Record<Clef, string> = {
    treble: 'Treble',
    bass: 'Bass',
    alto: 'Alto',
    percussion: 'Percussion',
    treble8va: 'Treble 8va',
    bass8vb: 'Bass 8vb',
};

/** The pitch on the middle line, where rests sit and a phantom starts on a rest */
export const MIDDLE_LINE_PITCH: Record<Clef, Pitch> = {
    treble: pitch('B4'),
    bass: pitch('D3'),
    alto: pitch('C4'),
    percussion: pitch('B4'),
    treble8va: pitch('B5'),
    bass8vb: pitch('D2'),
};

export function isClef(text: string): text is Clef {
    return (CLEFS as readonly string[]).includes(text);
}

/** The clef in effect in each of a part's measures */
export function resolveClefs(part: Part): Clef[] {
    let clef: Clef = part.clef ?? 'treble';
    return part.measures.map((partMeasure) => (clef = partMeasure.clef ?? clef));
}

export function clefAt(part: Pick<Part, 'clef' | 'measures'>, measure: number): Clef {
    let clef: Clef = part.clef ?? 'treble';
    for (const partMeasure of part.measures.slice(0, measure + 1)) clef = partMeasure.clef ?? clef;
    return clef;
}

/**
 * Drops any clef change that repeats the clef already in effect, so the score doesn't show a
 * change that isn't one. A change on the first measure becomes the part's starting clef.
 */
export function withoutRepeatedClefs(part: Part): Part {
    let clef: Clef = part.measures[0]?.clef ?? part.clef ?? 'treble';
    const starting = clef;
    const measures = part.measures.map((partMeasure, m) => {
        if (partMeasure.clef === undefined) return partMeasure;
        if (m > 0 && partMeasure.clef !== clef) {
            clef = partMeasure.clef;
            return partMeasure;
        }
        const { clef: _, ...rest } = partMeasure;
        return rest;
    });
    return { ...part, clef: starting, measures };
}
