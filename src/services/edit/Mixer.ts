/**
 * The mixer: a volume for each whole part, and a master volume over them all. Unlike volume
 * markings, these don't change through the piece; they set how the parts sit together.
 */

import { Composition } from '../composition/Composition';
import { Part } from '../part/Part';

/** What a part or the master plays at without a volume of its own */
export const NORMAL_MIX = 100;
/** A part can be pushed past normal as far as MIDI's channel volume goes */
export const MAX_PART_VOLUME = 127;
export const MAX_MASTER_VOLUME = 100;

export const partVolume = (part: Part) => part.volume ?? NORMAL_MIX;
export const masterVolume = (composition: Composition) => composition.volume ?? NORMAL_MIX;

const clamp = (percent: number, max: number) => Math.max(0, Math.min(max, Math.round(percent)));

/** Sets a part's mixer volume; normal is left unwritten */
export function setPartVolume(composition: Composition, index: number, percent: number): Composition {
    const volume = clamp(percent, MAX_PART_VOLUME);
    return {
        ...composition,
        parts: composition.parts.map((part, i) => {
            if (i !== index || partVolume(part) === volume) return part;
            const { volume: _, ...rest } = part;
            return volume === NORMAL_MIX ? rest : { ...rest, volume };
        }),
    };
}

export function setMasterVolume(composition: Composition, percent: number): Composition {
    const volume = clamp(percent, MAX_MASTER_VOLUME);
    if (masterVolume(composition) === volume) return composition;
    const { volume: _, ...rest } = composition;
    return volume === NORMAL_MIX ? rest : { ...rest, volume };
}

/** How loud each part plays against normal, master included: 1 is normal */
export const partMix = (composition: Composition): number[] =>
    composition.parts.map((part) => (partVolume(part) / 100) * (masterVolume(composition) / 100));
