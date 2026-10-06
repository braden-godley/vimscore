/** Volume markings: where a part's volume changes */

import { Composition } from '../composition/Composition';
import { Fraction, compare } from '../fraction/Fraction';

/** Marks a part's volume from a moment in a measure on, replacing a marking already there */
export function setVolume(
    composition: Composition,
    part: number,
    measure: number,
    offset: Fraction,
    percent: number,
): Composition {
    return {
        ...composition,
        parts: composition.parts.map((p, pi) =>
            pi !== part
                ? p
                : {
                      ...p,
                      measures: p.measures.map((partMeasure, mi) => {
                          if (mi !== measure) return partMeasure;
                          const others = (partMeasure.volumes ?? []).filter(
                              (mark) => compare(mark.offset, offset) !== 0,
                          );
                          const volumes = [...others, { offset, percent }].sort((a, b) =>
                              compare(a.offset, b.offset),
                          );
                          return { ...partMeasure, volumes };
                      }),
                  },
        ),
    };
}
