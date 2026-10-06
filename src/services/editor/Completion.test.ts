import { describe, expect, it } from 'vitest';
import { Completion, FolderEntry, completeCommandLine, completionText, cycleCompletion, pathArgument, pathMatches, splitPath } from './Completion';

const file = (name: string): FolderEntry => ({ name, folder: false });
const folder = (name: string): FolderEntry => ({ name, folder: true });

const FOLDERS: Record<string, FolderEntry[]> = {
    '': [file('Aqua.vimscore'), file('Aria.vimscore'), file('aqua.mscz'), file('notes.txt'), folder('Scores'), file('.hidden.vimscore')],
    '~/': [folder('Music'), folder('Movies'), file('piano.sf2')],
    'Scores/': [file('Waltz.vimscore')],
};
const list = async (typed: string) => FOLDERS[typed] ?? [];

describe('pathArgument', () => {
    it('finds the file name of the commands that take one', () => {
        expect(pathArgument('e Scores/W')).toEqual({ before: 'e ', path: 'Scores/W', extensions: ['vimscore', 'mscz', 'mscx'] });
        expect(pathArgument('w! my score')).toMatchObject({ before: 'w! ', path: 'my score' });
        expect(pathArgument('sf ~/pi')).toMatchObject({ path: '~/pi', extensions: ['sf2', 'sf3', 'dls'] });
        expect(pathArgument('export mid ou')).toMatchObject({ before: 'export mid ', path: 'ou', extensions: ['mid'] });
    });

    it('is undefined for commands without one, or before the file name starts', () => {
        expect(pathArgument('title Aqua')).toBeUndefined();
        expect(pathArgument('e')).toBeUndefined();
        expect(pathArgument('export wav x')).toBeUndefined();
        expect(pathArgument('export mp3')).toBeUndefined();
    });
});

describe('splitPath', () => {
    it('splits off the folder, and takes a bare ~ as home', () => {
        expect(splitPath('~/Mu')).toEqual({ folder: '~/', name: 'Mu' });
        expect(splitPath('Aq')).toEqual({ folder: '', name: 'Aq' });
        expect(splitPath('~')).toEqual({ folder: '~/', name: '' });
    });
});

describe('pathMatches', () => {
    it('offers folders and files the command reads, ignoring case, hiding dotfiles', () => {
        expect(pathMatches('a', FOLDERS['']!, ['vimscore'])).toEqual(['Aqua.vimscore', 'Aria.vimscore']);
        expect(pathMatches('', FOLDERS['']!, ['vimscore'])).toEqual(['Aqua.vimscore', 'Aria.vimscore', 'Scores/']);
        expect(pathMatches('.', FOLDERS['']!, ['vimscore'])).toEqual(['.hidden.vimscore']);
    });
});

describe('completeCommandLine', () => {
    const texts = (completion: Completion | undefined) => completion && completionText(completion);

    it('fills in a single match, folders with a slash', async () => {
        expect(texts(await completeCommandLine('e sc', list))).toBe('e Scores/');
        expect(texts(await completeCommandLine('e Scores/', list))).toBe('e Scores/Waltz.vimscore');
        expect(texts(await completeCommandLine('sf ~/p', list))).toBe('sf ~/piano.sf2');
    });

    it('fills in the first of several, or the last going back', async () => {
        const several = await completeCommandLine('sf ~', list);
        expect(several).toEqual({ before: 'sf ~/', typed: '', matches: ['Movies/', 'Music/', 'piano.sf2'], index: 0 });
        expect(texts(await completeCommandLine('e a', list, -1))).toBe('e Aria.vimscore');
    });

    it('is undefined when nothing matches, or nothing is a file name', async () => {
        expect(await completeCommandLine('e zz', list)).toBeUndefined();
        expect(await completeCommandLine('title A', list)).toBeUndefined();
    });
});

describe('cycleCompletion', () => {
    it('goes through the matches, then what was typed, then round again', () => {
        const start: Completion = { before: 'e ', typed: 'a', matches: ['aqua.mscz', 'Aqua.vimscore'], index: 0 };
        const forward = [1, 1, 1].reduce<Completion[]>((seen, step) => [...seen, cycleCompletion(seen.at(-1)!, step as 1)], [start]);
        expect(forward.map(completionText)).toEqual(['e aqua.mscz', 'e Aqua.vimscore', 'e a', 'e aqua.mscz']);
        expect(completionText(cycleCompletion(start, -1))).toBe('e a');
    });
});
