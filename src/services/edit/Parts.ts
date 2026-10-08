/** Changes to the score's parts (staves) and what they play */

import { withoutRepeatedClefs } from '../clef/Clef';
import { Composition } from '../composition/Composition';
import { durationsFilling } from '../duration/Duration';
import { Instrument, clefFor, generalMidiName, partInstrument } from '../instrument/Instrument';
import { resolveMeasures } from '../measure/Measure';
import { Clef, Part } from '../part/Part';
import { mergeRests } from './Edit';
import { rests } from './Stream';

function instrumentFields({ program, bank, drums, soundfont }: Instrument): Pick<Part, 'program' | 'bank' | 'drums' | 'soundfont'> {
    return { program, ...(bank !== 0 && { bank }), ...(drums && { drums }), ...(soundfont && { soundfont }) };
}

/** A new part playing `instrument`, named after it, with a rest in every measure, at `index` */
export function addPart(composition: Composition, index: number, instrument: Instrument): Composition {
    const measures = resolveMeasures(composition.measures).map(({ length }) => ({
        voices: [{ events: mergeRests(rests(durationsFilling(length))) }],
    }));
    const part: Part = { name: instrument.name, clef: clefFor(instrument), ...instrumentFields(instrument), measures };
    const parts = [...composition.parts];
    parts.splice(Math.max(0, Math.min(index, parts.length)), 0, part);
    return { ...composition, parts };
}

/** Removes a part; the last one stays, since a score needs a stave to edit */
export function deletePart(composition: Composition, index: number): Composition | undefined {
    if (composition.parts.length <= 1 || !composition.parts[index]) return undefined;
    return { ...composition, parts: composition.parts.filter((_, i) => i !== index) };
}

/** Moves a part to `to`, the others closing up around it; undefined past the top or bottom */
export function shiftPart(composition: Composition, from: number, to: number): Composition | undefined {
    const { parts } = composition;
    const part = parts[from];
    if (!part || to === from || to < 0 || to >= parts.length) return undefined;
    const shifted = parts.filter((_, i) => i !== from);
    shifted.splice(to, 0, part);
    return { ...composition, parts: shifted };
}

function withPart(composition: Composition, index: number, change: (part: Part) => Part): Composition {
    return { ...composition, parts: composition.parts.map((part, i) => (i === index ? change(part) : part)) };
}

export function renamePart(composition: Composition, index: number, name: string): Composition {
    return withPart(composition, index, (part) => ({ ...part, name }));
}

/** Changes a part's clef from a measure on, until the next measure that sets its own */
export function setClef(composition: Composition, index: number, measure: number, clef: Clef): Composition {
    return withPart(composition, index, (part) => {
        if (!part.measures[measure]) return measure === 0 ? { ...part, clef } : part;
        const measures = part.measures.map((partMeasure, m) => (m === measure ? { ...partMeasure, clef } : partMeasure));
        return withoutRepeatedClefs({ ...part, measures });
    });
}

/**
 * Gives a part a new instrument. A part still named after its old instrument takes the new
 * one's name; one named something else (`Melody`, or a `:rename`) keeps it. `instruments` is
 * what the soundfont calls things, for recognising the old name.
 */
export function setInstrument(
    composition: Composition,
    index: number,
    instrument: Instrument,
    instruments: Instrument[] = [],
): Composition {
    return withPart(composition, index, (part) => {
        const old = partInstrument(part);
        const oldNames = [
            generalMidiName(old.program),
            ...instruments
                .filter(({ program, bank, drums }) => program === old.program && bank === old.bank && drums === old.drums)
                .map(({ name }) => name),
        ];
        const { bank: _, drums: __, soundfont: ___, ...rest } = part;
        return {
            ...rest,
            ...instrumentFields(instrument),
            name: oldNames.includes(part.name) ? instrument.name : part.name,
        };
    });
}

/** The soundfonts a score plays through, the first taking precedence */
export function setSoundfonts(composition: Composition, filePaths: string[]): Composition {
    return { ...composition, soundfonts: filePaths.map((filePath) => ({ filePath })) };
}
