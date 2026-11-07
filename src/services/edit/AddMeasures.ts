/**
 * Putting empty measures into the score, in every part, before a measure. The music from there
 * on moves later, keeping the time signature, key, tempo, clef and dynamic it had.
 */

import { Composition } from '../composition/Composition';
import { durationsFilling } from '../duration/Duration';
import { Rest } from '../event/Event';
import { MeasureInfo, PartMeasure, measureLength, resolveMeasures } from '../measure/Measure';
import { clefAt, withoutRepeatedClefs } from '../clef/Clef';
import { endingBefore } from './RemoveMeasures';

/**
 * Puts `count` measures of rests before measure `at` in every part; undefined when there's no
 * measure `at`. They're in the time signature, key, tempo and clef of the measure before; the
 * measure at `at` keeps any change it makes, so the new measures go in before it. Ties, slurs and glissandi into it from the measure before
 * come off, as they'd lead into rests, and hairpins running into it end there.
 */
export function addMeasures(composition: Composition, at: number, count: number): Composition | undefined {
    if (at < 0 || at >= composition.measures.length || count < 1) return undefined;

    const resolved = resolveMeasures(composition.measures);
    const { timeSignature } = resolved[at - 1] ?? resolved[at]!;
    const rests: Rest[] = durationsFilling(measureLength(timeSignature)).map((duration) => ({ kind: 'rest', duration }));
    const emptyMeasure = (): PartMeasure => ({ voices: [{ events: rests.map((rest) => ({ ...rest })) }] });

    // At the start, the score's opening time signature, key and tempo move to the new first
    // measure, so the music that was first doesn't restate them
    const infos: MeasureInfo[] = Array.from({ length: count }, () => ({}));
    let measures = composition.measures;
    if (at === 0 && measures[0]) {
        const { timeSignature: t, keySignature: k, tempo, ...rest } = measures[0];
        infos[0] = { ...(t && { timeSignature: t }), ...(k && { keySignature: k }), ...(tempo && { tempo }) };
        measures = [rest, ...measures.slice(1)];
    }

    const parts = composition.parts.map((part) => {
        // A clef change on the first measure is where the part starts, so the new measures take it
        const clef = at === 0 && part.measures.length > 0 ? clefAt(part, 0) : part.clef;
        const kept = part.measures.map((partMeasure, m) => endingBefore(partMeasure, m, at, resolved));
        const added = Array.from({ length: count }, emptyMeasure);
        const edited = { ...part, ...(clef && { clef }), measures: [...kept.slice(0, at), ...added, ...kept.slice(at)] };
        return withoutRepeatedClefs(edited);
    });

    return { ...composition, measures: [...measures.slice(0, at), ...infos, ...measures.slice(at)], parts };
}
