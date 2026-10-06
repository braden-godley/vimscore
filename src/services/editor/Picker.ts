/**
 * The instrument picker: a list filtered by what's typed, with a selection moved by arrow keys
 * or Ctrl-N/P (letters go into the filter, so j/k can't move it). Moving plays the selected
 * instrument so you can hear it before choosing.
 */

import { Instrument, clefFor, filterInstruments } from '../instrument/Instrument';

export interface Picker {
    /** What the choice is for: the cursor's part, or a new part below it */
    purpose: 'instrument' | 'addPart';
    query: string;
    /** Index into the filtered list */
    selected: number;
}

export type PickerOutcome =
    | { picker: Picker; audition?: Instrument }
    | { chosen: Instrument }
    | { cancelled: true };

const DOWN = new Set(['<Down>', '<C-n>', '<C-j>', '<Tab>']);
const UP = new Set(['<Up>', '<C-p>', '<C-k>', '<S-Tab>']);

export function pickerItems(picker: Picker, instruments: Instrument[]): Instrument[] {
    return filterInstruments(instruments, picker.query);
}

/** A note in the instrument's usual range: middle C, an octave lower in bass clef, a snare for drums */
export function auditionPitch(instrument: Instrument): number {
    if (instrument.drums) return 38;
    return clefFor(instrument) === 'bass' ? 48 : 60;
}

export function pickerKey(picker: Picker, instruments: Instrument[], key: string, text?: string): PickerOutcome {
    const items = pickerItems(picker, instruments);
    if (key === '<Esc>') return { cancelled: true };
    if (key === '<CR>') {
        const chosen = items[picker.selected];
        return chosen ? { chosen } : { picker };
    }

    const step = DOWN.has(key) ? 1 : UP.has(key) ? -1 : 0;
    if (step !== 0) {
        if (items.length === 0) return { picker };
        const selected = (picker.selected + step + items.length) % items.length;
        return { picker: { ...picker, selected }, audition: items[selected] };
    }

    const query =
        key === '<BS>'
            ? picker.query.slice(0, -1)
            : picker.query + (key === '<Space>' ? ' ' : (text ?? (key.length === 1 ? key : '')));
    return { picker: { ...picker, query, selected: 0 } };
}
