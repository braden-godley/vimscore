/**
 * The pickers: a list filtered by what's typed, with a selection moved by arrow keys or Ctrl-N/P
 * (letters go into the filter, so j/k can't move it). The instrument picker plays the selected
 * instrument so you can hear it before choosing; the recent picker opens a score from before.
 */

import { Instrument, clefFor, filterInstruments } from '../instrument/Instrument';

export interface Picker {
    /** What the choice is for: the cursor's part, a new part below it, or a score to open */
    purpose: 'instrument' | 'addPart' | 'recent';
    query: string;
    /** Index into the filtered list */
    selected: number;
}

export type PickerOutcome =
    | { picker: Picker; audition?: Instrument }
    | { chosen: Instrument }
    | { cancelled: true };

/** What a key does to any picker, given its filtered items; `moved` is what the selection landed on */
export type ListOutcome<T> = { picker: Picker; moved?: T } | { chosen: T } | { cancelled: true };

const DOWN = new Set(['<Down>', '<C-n>', '<C-j>', '<Tab>']);
const UP = new Set(['<Up>', '<C-p>', '<C-k>', '<S-Tab>']);

export function pickerItems(picker: Picker, instruments: Instrument[]): Instrument[] {
    return filterInstruments(instruments, picker.query);
}

/** Recent scores whose paths have every word typed, still newest first */
export function filterPaths(paths: string[], query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return paths.filter((path) => words.every((word) => path.toLowerCase().includes(word)));
}

/** A note in the instrument's usual range: middle C, an octave lower in bass clef, a snare for drums */
export function auditionPitch(instrument: Instrument): number {
    if (instrument.drums) return 38;
    return clefFor(instrument) === 'bass' ? 48 : 60;
}

export function pickerKey(picker: Picker, instruments: Instrument[], key: string, text?: string): PickerOutcome {
    const outcome = listKey(picker, pickerItems(picker, instruments), key, text);
    if (!('picker' in outcome)) return outcome;
    return outcome.moved ? { picker: outcome.picker, audition: outcome.moved } : { picker: outcome.picker };
}

export function listKey<T>(picker: Picker, items: T[], key: string, text?: string): ListOutcome<T> {
    if (key === '<Esc>') return { cancelled: true };
    if (key === '<CR>') {
        const chosen = items[picker.selected];
        return chosen ? { chosen } : { picker };
    }

    const step = DOWN.has(key) ? 1 : UP.has(key) ? -1 : 0;
    if (step !== 0) {
        if (items.length === 0) return { picker };
        const selected = (picker.selected + step + items.length) % items.length;
        return { picker: { ...picker, selected }, moved: items[selected] };
    }

    const query =
        key === '<BS>'
            ? picker.query.slice(0, -1)
            : picker.query + (key === '<Space>' ? ' ' : (text ?? (key.length === 1 ? key : '')));
    return { picker: { ...picker, query, selected: 0 } };
}
