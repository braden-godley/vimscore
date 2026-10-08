/** Dynamic markings and hairpins: where and how hard a part's notes are played */

import { Composition } from '../composition/Composition';
import { DEFAULT_DYNAMIC, Dynamic, stepDynamic } from '../dynamic/Dynamic';
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

/**
 * Marks a part's dynamic from a moment in a measure on, replacing a marking already there, or
 * without a dynamic takes the marking there off
 */
export function setDynamic(
    composition: Composition,
    part: number,
    measure: number,
    offset: Fraction,
    dynamic: Dynamic | undefined,
): Composition {
    return editPartMeasure(composition, part, measure, ({ dynamics: existing = [], ...partMeasure }) => {
        const others = existing.filter((mark) => compare(mark.offset, offset) !== 0);
        const dynamics = dynamic
            ? [...others, { offset, dynamic }].sort((a, b) => compare(a.offset, b.offset))
            : others;
        return { ...partMeasure, ...(dynamics.length > 0 && { dynamics }) };
    });
}

/** The dynamic in effect in a part just before a moment: the last marking before it, or mf */
export function dynamicBefore(composition: Composition, part: number, measure: number, offset: Fraction): Dynamic {
    let dynamic = DEFAULT_DYNAMIC;
    for (const [m, partMeasure] of (composition.parts[part]?.measures ?? []).slice(0, measure + 1).entries()) {
        for (const mark of partMeasure.dynamics ?? []) {
            if (m === measure && compare(mark.offset, offset) >= 0) break;
            dynamic = mark.dynamic;
        }
    }
    return dynamic;
}

/**
 * Makes a part `steps` dynamics louder from a moment on, or softer for a negative count, by
 * marking it there, stopping at ppp and ff. A marking that comes back to the dynamic already in
 * effect says nothing new, so it's taken off.
 */
export function stepDynamicAt(
    composition: Composition,
    part: number,
    measure: number,
    offset: Fraction,
    steps: number,
): Composition {
    const marked = composition.parts[part]?.measures[measure]?.dynamics?.find((mark) => compare(mark.offset, offset) === 0);
    const before = dynamicBefore(composition, part, measure, offset);
    const current = marked?.dynamic ?? before;
    const dynamic = stepDynamic(current, steps);
    // Already at ppp or ff
    if (dynamic === current) return composition;
    return setDynamic(composition, part, measure, offset, dynamic === before ? undefined : dynamic);
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
