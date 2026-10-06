import { describe, expect, it } from 'vitest';
import { GENERAL_MIDI_INSTRUMENTS, filterInstruments } from '../instrument/Instrument';
import { Picker, auditionPitch, pickerItems, pickerKey } from './Picker';

const start: Picker = { purpose: 'instrument', query: '', selected: 0 };
const names = (picker: Picker) => pickerItems(picker, GENERAL_MIDI_INSTRUMENTS).map(({ name }) => name);

describe('filterInstruments', () => {
    it('matches every word, names that start with the first word first', () => {
        expect(filterInstruments(GENERAL_MIDI_INSTRUMENTS, 'vio').map(({ name }) => name)).toEqual(['Violin', 'Viola']);
        expect(filterInstruments(GENERAL_MIDI_INSTRUMENTS, 'bass slap').map(({ name }) => name)).toEqual([
            'Slap Bass 1',
            'Slap Bass 2',
        ]);
        // General MIDI numbers count from 1
        expect(filterInstruments(GENERAL_MIDI_INSTRUMENTS, '41').map(({ name }) => name)).toEqual(['Violin']);
    });
});

describe('pickerKey', () => {
    it('filters as you type, back to the top of the list', () => {
        const typed = ['c', 'e', 'l'].reduce((picker, key) => {
            const outcome = pickerKey(picker, GENERAL_MIDI_INSTRUMENTS, key);
            return 'picker' in outcome ? outcome.picker : picker;
        }, start);
        expect(names(typed)).toEqual(['Celesta', 'Cello']);
        const outcome = pickerKey({ ...typed, selected: 1 }, GENERAL_MIDI_INSTRUMENTS, '<BS>');
        expect(outcome).toEqual({ picker: { ...typed, query: 'ce', selected: 0 } });
    });

    it('moves with arrows and Ctrl-N/P, wrapping, and plays what it lands on', () => {
        const picker = { ...start, query: 'vio' };
        expect(pickerKey(picker, GENERAL_MIDI_INSTRUMENTS, '<Down>')).toEqual({
            picker: { ...picker, selected: 1 },
            audition: expect.objectContaining({ name: 'Viola' }),
        });
        expect(pickerKey(picker, GENERAL_MIDI_INSTRUMENTS, '<C-p>')).toMatchObject({ picker: { selected: 1 } });
        // j is a letter here
        expect(pickerKey(picker, GENERAL_MIDI_INSTRUMENTS, 'j')).toMatchObject({ picker: { query: 'vioj' } });
    });

    it('chooses the selected one, or cancels', () => {
        expect(pickerKey({ ...start, query: 'vio', selected: 1 }, GENERAL_MIDI_INSTRUMENTS, '<CR>')).toEqual({
            chosen: expect.objectContaining({ name: 'Viola', program: 41 }),
        });
        expect(pickerKey({ ...start, query: 'zzz' }, GENERAL_MIDI_INSTRUMENTS, '<CR>')).toMatchObject({ picker: {} });
        expect(pickerKey(start, GENERAL_MIDI_INSTRUMENTS, '<Esc>')).toEqual({ cancelled: true });
    });
});

describe('auditionPitch', () => {
    it('plays in the instrument’s range', () => {
        expect(auditionPitch(GENERAL_MIDI_INSTRUMENTS[40]!)).toBe(60);
        expect(auditionPitch(GENERAL_MIDI_INSTRUMENTS[42]!)).toBe(48);
        expect(auditionPitch({ name: 'Standard', program: 0, bank: 128, drums: true })).toBe(38);
    });
});
