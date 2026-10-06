/** Repeat barlines, which every part shares */

import { Composition } from '../composition/Composition';

/** Turns a measure's repeat start or end on, or off if it's there already */
export function toggleRepeat(composition: Composition, measure: number, which: 'start' | 'end'): Composition {
    const field = which === 'start' ? 'repeatStart' : 'repeatEnd';
    return {
        ...composition,
        measures: composition.measures.map((info, i) => {
            if (i !== measure) return info;
            const { [field]: on, ...rest } = info;
            return on ? rest : { ...rest, [field]: true };
        }),
    };
}
