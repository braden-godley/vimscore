/** Volume markings and hairpins: where and how a part's volume changes */

import { Composition } from '../composition/Composition';
import { Fraction, compare } from '../fraction/Fraction';
import { HairpinKind, PartMeasure } from '../measure/Measure';

/** Replaces one part's measure with what `edit` makes of it */
function editPartMeasure(
    composition: Composition,
    part: number,
    measure: number,
    edit: (partMeasure: PartMeasure) => PartMeasure,
): Composition {
    return {
        ...composition,
        parts: composition.parts.map((p, pi) =>
            pi !== part
                ? p
                : { ...p, measures: p.measures.map((partMeasure, mi) => (mi === measure ? edit(partMeasure) : partMeasure)) },
        ),
    };
}

/** Marks a part's volume from a moment in a measure on, replacing a marking already there */
export function setVolume(
    composition: Composition,
    part: number,
    measure: number,
    offset: Fraction,
    percent: number,
): Composition {
    return editPartMeasure(composition, part, measure, (partMeasure) => {
        const others = (partMeasure.volumes ?? []).filter((mark) => compare(mark.offset, offset) !== 0);
        const volumes = [...others, { offset, percent }].sort((a, b) => compare(a.offset, b.offset));
        return { ...partMeasure, volumes };
    });
}

/**
 * Puts a crescendo or diminuendo on a part, starting at a moment in a measure and lasting
 * `length` whole notes, replacing a hairpin already starting there. The same hairpin again
 * takes it off, so the key that adds one also removes it.
 */
export function toggleHairpin(
    composition: Composition,
    part: number,
    measure: number,
    offset: Fraction,
    length: Fraction,
    kind: HairpinKind,
): Composition {
    return editPartMeasure(composition, part, measure, ({ hairpins: existing = [], ...partMeasure }) => {
        const there = existing.find((hairpin) => compare(hairpin.offset, offset) === 0);
        const others = existing.filter((hairpin) => hairpin !== there);
        const same = there?.kind === kind && compare(there.length, length) === 0;
        const hairpins = same ? others : [...others, { offset, length, kind }].sort((a, b) => compare(a.offset, b.offset));
        return { ...partMeasure, ...(hairpins.length > 0 && { hairpins }) };
    });
}
