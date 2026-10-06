/**
 * The mixer, open over the score: a row for each part's volume and one for the master volume
 * under them. j/k move between rows, h/l turn the volume down and up by 5, H/L by 1, and `=`
 * puts it back to normal. m mutes a part and s solos it.
 */

import { Composition } from '../composition/Composition';
import {
    NORMAL_MIX,
    masterVolume,
    partVolume,
    setMasterVolume,
    setPartVolume,
    toggleMute,
    toggleSolo,
} from '../edit/Mixer';

export interface Mixer {
    /** A part's index, or the number of parts for the master row */
    selected: number;
}

export type MixerOutcome = { mixer: Mixer; composition?: Composition } | { closed: true };

const DOWN = new Set(['j', '<Down>', '<C-n>', '<Tab>']);
const UP = new Set(['k', '<Up>', '<C-p>', '<S-Tab>']);
const STEPS: Record<string, number> = { l: 5, '<Right>': 5, h: -5, '<Left>': -5, L: 1, H: -1 };
const CLOSE = new Set(['<Esc>', '<CR>', 'q']);

const isMaster = (composition: Composition, { selected }: Mixer) => selected >= composition.parts.length;

/** The selected row's volume */
export function mixerVolume(composition: Composition, mixer: Mixer): number {
    return isMaster(composition, mixer) ? masterVolume(composition) : partVolume(composition.parts[mixer.selected]!);
}

function setVolume(composition: Composition, mixer: Mixer, percent: number): Composition {
    return isMaster(composition, mixer)
        ? setMasterVolume(composition, percent)
        : setPartVolume(composition, mixer.selected, percent);
}

export function mixerKey(composition: Composition, mixer: Mixer, key: string): MixerOutcome {
    if (CLOSE.has(key)) return { closed: true };

    const rows = composition.parts.length + 1;
    const move = DOWN.has(key) ? 1 : UP.has(key) ? -1 : 0;
    if (move !== 0) return { mixer: { selected: (mixer.selected + move + rows) % rows } };

    const step = STEPS[key];
    if (step !== undefined) return { mixer, composition: setVolume(composition, mixer, mixerVolume(composition, mixer) + step) };
    if (key === '=') return { mixer, composition: setVolume(composition, mixer, NORMAL_MIX) };
    // The master has no mute or solo of its own
    if (key === 'm') return { mixer, composition: toggleMute(composition, mixer.selected) };
    if (key === 's') return { mixer, composition: toggleSolo(composition, mixer.selected) };
    return { mixer };
}
