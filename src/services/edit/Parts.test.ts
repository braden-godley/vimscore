import { describe, expect, it } from 'vitest';
import { newComposition, withTrailingEmptyMeasure } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { GENERAL_MIDI_INSTRUMENTS } from '../instrument/Instrument';
import { addPart, deletePart, renamePart, setClef, setInstrument } from './Parts';
import { written } from './written';

const cello = GENERAL_MIDI_INSTRUMENTS[42]!;
const violin = GENERAL_MIDI_INSTRUMENTS[40]!;

describe('addPart', () => {
    it('adds a part of rests named after its instrument, with a clef for its range', () => {
        const added = addPart(exampleComposition, 1, cello);
        expect(added.parts.map(({ name }) => name)).toEqual(['Melody', 'Cello', 'Bass']);
        expect(added.parts[1]).toMatchObject({ clef: 'bass', program: 42 });
        expect([0, 1, 2].map((m) => written(added, 1, m))).toEqual(['r/w', 'r/h.', 'r/h.']);
        expect(addPart(exampleComposition, 9, violin).parts.at(-1)).toMatchObject({ name: 'Violin', clef: 'treble' });
    });

    it('keeps a soundfont bank and drums', () => {
        const kit = addPart(exampleComposition, 0, { name: 'Standard', program: 0, bank: 128, drums: true });
        expect(kit.parts[0]).toMatchObject({ name: 'Standard', bank: 128, drums: true, clef: 'treble' });
    });
});

describe('deletePart', () => {
    it('removes a part, but never the last', () => {
        expect(deletePart(exampleComposition, 0)?.parts.map(({ name }) => name)).toEqual(['Bass']);
        const single = deletePart(exampleComposition, 0)!;
        expect(deletePart(single, 0)).toBeUndefined();
    });
});

describe('setInstrument', () => {
    it('renames a part named after its old instrument', () => {
        const piano = withTrailingEmptyMeasure(newComposition());
        expect(setInstrument(piano, 0, violin).parts[0]).toMatchObject({ name: 'Violin', program: 40 });
    });

    it('keeps a name of its own', () => {
        expect(setInstrument(exampleComposition, 0, violin).parts[0]).toMatchObject({ name: 'Melody', program: 40 });
    });

    it("recognises the soundfont's name for the old instrument, and clears an old bank", () => {
        const soundfont = [{ name: 'Yamaha Grand', program: 0, bank: 0, drums: false }];
        const named = renamePart(exampleComposition, 0, 'Yamaha Grand');
        const changed = setInstrument({ ...named, parts: [{ ...named.parts[0]!, bank: 8 }] }, 0, violin, [
            { ...soundfont[0]!, bank: 8 },
        ]);
        expect(changed.parts[0]).toMatchObject({ name: 'Violin', program: 40 });
        expect(changed.parts[0]!.bank).toBeUndefined();
    });

    it("keeps which soundfont the sound is from, and clears an old one's", () => {
        const strings = { name: 'Strings', program: 48, bank: 0, drums: false };
        const chosen = setInstrument(exampleComposition, 0, { ...strings, soundfont: '/sf/second.sf2' });
        expect(chosen.parts[0]!.soundfont).toBe('/sf/second.sf2');
        expect(setInstrument(chosen, 0, violin).parts[0]!.soundfont).toBeUndefined();
    });
});

describe('renamePart and setClef', () => {
    it('change just that', () => {
        expect(renamePart(exampleComposition, 1, 'Left hand').parts[1]!.name).toBe('Left hand');
        expect(setClef(exampleComposition, 0, 'bass').parts[0]!.clef).toBe('bass');
    });
});
