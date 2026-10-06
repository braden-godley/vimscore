/**
 * A soundfont describes the sound of each instrument. A score can play through several, like
 * MuseScore: each part can choose its sound from any of them, so where two both have strings,
 * either one's can play. A part that hasn't chosen one plays the first in the list with its
 * bank and program, so a small soundfont at the top can replace a few of a big one's.
 */

import { Instrument, sameSound } from '../instrument/Instrument';

export interface Soundfont {
    filePath: string;
}

/** A soundfont that's loaded, and the instruments in it */
export interface LoadedSoundfont {
    path: string;
    instruments: Instrument[];
}

/**
 * Which soundfont plays an instrument: the one it's from, if that's loaded, or else the first
 * with its bank and program, or else the first, which plays something close.
 */
export function soundfontFor<T extends LoadedSoundfont>(instrument: Instrument, loaded: T[]): T | undefined {
    const chosen = instrument.soundfont && loaded.find(({ path }) => path === instrument.soundfont);
    return chosen || loaded.find(({ instruments }) => instruments.some((other) => sameSound(other, instrument))) || loaded[0];
}

/** Every instrument in the loaded soundfonts, in priority order, each marked with its soundfont */
export function allInstruments(loaded: LoadedSoundfont[]): Instrument[] {
    return loaded.flatMap(({ path, instruments }) => instruments.map((instrument) => ({ ...instrument, soundfont: path })));
}

/** Puts a soundfont first, taking precedence over the rest; one already there moves up */
export function addSoundfont(soundfonts: Soundfont[], filePath: string): Soundfont[] {
    return [{ filePath }, ...soundfonts.filter((soundfont) => soundfont.filePath !== filePath)];
}

/**
 * The soundfont `which` names: its place in the list counting from 1, or its file's name, whole
 * or without the extension. Undefined when nothing matches.
 */
export function findSoundfont(soundfonts: Soundfont[], which: string): number | undefined {
    if (/^\d+$/.test(which)) {
        const index = Number(which) - 1;
        return index >= 0 && index < soundfonts.length ? index : undefined;
    }
    const name = which.toLowerCase();
    const index = soundfonts.findIndex(({ filePath }) => {
        const file = soundfontName(filePath).toLowerCase();
        return file === name || file.replace(/\.[^.]*$/, '') === name;
    });
    return index === -1 ? undefined : index;
}

/** A soundfont's file name, for messages */
export function soundfontName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** The list for the status bar: `1 big.sf2, 2 small.sf2`, first played first */
export function describeSoundfonts(soundfonts: Soundfont[]): string {
    if (soundfonts.length === 0) return 'No soundfonts; load one with :soundfont';
    return soundfonts.map(({ filePath }, i) => `${i + 1} ${soundfontName(filePath)}`).join(', ');
}
