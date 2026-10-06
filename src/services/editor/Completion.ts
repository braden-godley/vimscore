/** Completing a file name on the `:` command line with `<Tab>`, like a shell */

import { Command, EXPORT_EXTENSIONS, ExportFormat, commandName } from './CommandLine';

export interface FolderEntry {
    name: string;
    folder: boolean;
}

/** Lists a folder typed on the command line (`~/`, `../`, or '' for the score's own), or [] */
export type ListFolder = (typed: string) => Promise<FolderEntry[]>;

const SCORE = ['vimscore'];
/** The files each command reads or writes; folders are always offered, to go into */
const EXTENSIONS: Partial<Record<Command['name'], string[]>> = {
    write: SCORE,
    writeQuit: SCORE,
    edit: ['vimscore', 'mscz', 'mscx'],
    soundfont: ['sf2', 'sf3', 'dls'],
    addSoundfont: ['sf2', 'sf3', 'dls'],
};

/** Where a command's file name starts in the text, and the extensions it looks for; undefined when it takes none */
export function pathArgument(text: string): { before: string; path: string; extensions: string[] } | undefined {
    // `:export` takes its file after the format
    const exporting = /^(\s*export!?\s+(\S+)\s+)(.*)$/.exec(text);
    if (exporting) {
        const format = (exporting[2] === 'mid' ? 'midi' : exporting[2]) as ExportFormat;
        const extension = EXPORT_EXTENSIONS[format];
        return extension ? { before: exporting[1]!, path: exporting[3]!, extensions: [extension] } : undefined;
    }
    const match = /^(\s*([a-z]+)!?\s+)(.*)$/.exec(text);
    const name = match && commandName(match[2]!);
    const extensions = name && EXTENSIONS[name];
    return extensions ? { before: match[1]!, path: match[3]!, extensions } : undefined;
}

/** The folder part of a typed path, with its slash, and the name being typed in it */
export function splitPath(path: string): { folder: string; name: string } {
    if (path === '~') return { folder: '~/', name: '' };
    const slash = path.lastIndexOf('/');
    return { folder: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

const hasExtension = (name: string, extensions: string[]) =>
    extensions.some((extension) => name.toLowerCase().endsWith(`.${extension}`));

/**
 * The names in a folder that `typed` could be: folders, and files with one of the extensions.
 * Case doesn't matter, and hidden ones only show once a `.` is typed. Folders end with `/`.
 */
export function pathMatches(typed: string, entries: FolderEntry[], extensions: string[]): string[] {
    const lower = typed.toLowerCase();
    return entries
        .filter(({ name, folder }) => (folder || hasExtension(name, extensions)) && name.toLowerCase().startsWith(lower))
        .filter(({ name }) => typed.startsWith('.') || !name.startsWith('.'))
        .map(({ name, folder }) => (folder ? `${name}/` : name))
        .sort((a, b) => a.localeCompare(b));
}

/** File names to cycle through with `<Tab>` */
export interface Completion {
    /** The command line up to the name being completed */
    before: string;
    /** What was typed of the name, which cycling past the last match comes back to */
    typed: string;
    matches: string[];
    /** The match shown, or -1 for what was typed */
    index: number;
}

/** The command line with the completion's current match filled in */
export const completionText = ({ before, typed, matches, index }: Completion) => before + (matches[index] ?? typed);

/** `<Tab>` again goes on to the next match, `<S-Tab>` back; between the last and first is what was typed */
export function cycleCompletion(completion: Completion, step: 1 | -1): Completion {
    const count = completion.matches.length + 1;
    return { ...completion, index: ((((completion.index + 1 + step) % count) + count) % count) - 1 };
}

/**
 * `<Tab>` on the command line: the file names it could be finishing, the first filled in, or
 * undefined when it isn't typing a file name or nothing matches. `<S-Tab>` starts at the last.
 */
export async function completeCommandLine(text: string, list: ListFolder, step: 1 | -1 = 1): Promise<Completion | undefined> {
    const argument = pathArgument(text);
    if (!argument) return undefined;
    const { folder, name } = splitPath(argument.path);
    const matches = pathMatches(name, await list(folder), argument.extensions);
    if (matches.length === 0) return undefined;
    return cycleCompletion({ before: argument.before + folder, typed: name, matches, index: -1 }, step);
}
