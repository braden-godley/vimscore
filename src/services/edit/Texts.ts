/** Text written above a part's beat, like a chord symbol or "pizz." */

import { Composition } from '../composition/Composition';
import { Fraction, compare } from '../fraction/Fraction';
import { editPartMeasure } from './Dynamics';

/** The text above a part's beat, if there is any */
export function textAt(composition: Composition, part: number, measure: number, offset: Fraction): string | undefined {
    return composition.parts[part]?.measures[measure]?.texts?.find((mark) => compare(mark.offset, offset) === 0)?.text;
}

/** Writes text above a part's beat, replacing what was there; empty text takes it away */
export function setText(composition: Composition, part: number, measure: number, offset: Fraction, text: string): Composition {
    if ((textAt(composition, part, measure, offset) ?? '') === text) return composition;
    return editPartMeasure(composition, part, measure, ({ texts: existing = [], ...partMeasure }) => {
        const others = existing.filter((mark) => compare(mark.offset, offset) !== 0);
        const texts = text ? [...others, { offset, text }].sort((a, b) => compare(a.offset, b.offset)) : others;
        return { ...partMeasure, ...(texts.length > 0 && { texts }) };
    });
}
