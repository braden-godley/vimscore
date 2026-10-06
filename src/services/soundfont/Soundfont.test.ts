import { describe, expect, it } from 'vitest';
import { addSoundfont, allInstruments, describeSoundfonts, findSoundfont, soundfontFor } from './Soundfont';

const list = [{ filePath: '/sf/Strings.sf2' }, { filePath: '/sf/General User.sf2' }];

describe('addSoundfont', () => {
    it('puts a new one first, over the rest', () => {
        expect(addSoundfont(list, '/sf/Brass.sf3').map(({ filePath }) => filePath)).toEqual([
            '/sf/Brass.sf3',
            '/sf/Strings.sf2',
            '/sf/General User.sf2',
        ]);
    });

    it('moves one already there to the top', () => {
        expect(addSoundfont(list, '/sf/General User.sf2')).toEqual([list[1], list[0]]);
    });
});

describe('findSoundfont', () => {
    it('finds one by its place, counting from 1', () => {
        expect(findSoundfont(list, '2')).toBe(1);
        expect(findSoundfont(list, '0')).toBeUndefined();
        expect(findSoundfont(list, '3')).toBeUndefined();
    });

    it('finds one by its file name, with or without the extension', () => {
        expect(findSoundfont(list, 'general user')).toBe(1);
        expect(findSoundfont(list, 'Strings.sf2')).toBe(0);
        expect(findSoundfont(list, 'Brass')).toBeUndefined();
    });
});

describe('describeSoundfonts', () => {
    it('lists them in priority order', () => {
        expect(describeSoundfonts(list)).toBe('1 Strings.sf2, 2 General User.sf2');
        expect(describeSoundfonts([])).toBe('No soundfonts; load one with :soundfont');
    });
});

describe('soundfontFor', () => {
    const strings = { name: 'Strings', program: 48, bank: 0, drums: false };
    const flute = { name: 'Flute', program: 73, bank: 0, drums: false };
    const loaded = [
        { path: '/sf/small.sf2', instruments: [flute] },
        { path: '/sf/big.sf2', instruments: [flute, strings] },
        { path: '/sf/strings.sf2', instruments: [{ ...strings, name: 'Lush Strings' }] },
    ];

    it('plays the soundfont an instrument is from', () => {
        expect(soundfontFor({ ...strings, soundfont: '/sf/strings.sf2' }, loaded)).toBe(loaded[2]);
        expect(soundfontFor({ ...flute, soundfont: '/sf/big.sf2' }, loaded)).toBe(loaded[1]);
    });

    it('otherwise plays the first with its bank and program', () => {
        expect(soundfontFor(strings, loaded)).toBe(loaded[1]);
        expect(soundfontFor(flute, loaded)).toBe(loaded[0]);
        // Its own soundfont isn't loaded any more
        expect(soundfontFor({ ...strings, soundfont: '/sf/gone.sf2' }, loaded)).toBe(loaded[1]);
    });

    it('falls back on the first, which plays something close', () => {
        expect(soundfontFor({ ...flute, program: 0 }, loaded)).toBe(loaded[0]);
        expect(soundfontFor(flute, [])).toBeUndefined();
    });

    it('lists every soundfont’s instruments, the same sound from each', () => {
        expect(allInstruments(loaded).filter(({ program }) => program === 48)).toEqual([
            { ...strings, soundfont: '/sf/big.sf2' },
            { ...strings, name: 'Lush Strings', soundfont: '/sf/strings.sf2' },
        ]);
    });
});
