/** Reading what's typed on the `:` command line into a command */

import { Duration } from '../duration/Duration';
import { KeySignature } from '../key/KeySignature';
import { TimeSignature } from '../measure/Measure';
import { CLEFS, Clef, isClef } from '../clef/Clef';
import { parseKeySignature, parseTempo, parseTimeSignature } from './MeasureValues';

export type Command =
    /** `:w [path]`, `:w! path` to write over a file that's there */
    | { name: 'write'; path?: string; force: boolean }
    /** `:e path`, or `:e!` to throw away changes and read the file again */
    | { name: 'edit'; path?: string; force: boolean }
    /** `:enew`, a blank score */
    | { name: 'new'; force: boolean }
    | { name: 'quit'; force: boolean }
    /** `:wq` and `:x` */
    | { name: 'writeQuit'; path?: string }
    /** `:export mp3|mp4|musanim|midi [path]`, beside the score file when there's no path; `!` to replace a file */
    | { name: 'export'; format: ExportFormat; path?: string; force: boolean }
    /** `:soundfont [path]` plays through just this soundfont, asking with a dialog when there's no path */
    | { name: 'soundfont'; path?: string }
    /** `:addsf [path]` puts a soundfont first, over the others; one already there moves up */
    | { name: 'addSoundfont'; path?: string }
    /** `:delsf 2` or `:delsf name` stops playing through one */
    | { name: 'deleteSoundfont'; which: string }
    /** `:soundfonts`, in priority order */
    | { name: 'listSoundfonts' }
    /** `:instrument [filter]` opens the picker for the cursor's part, filtered as typed */
    | { name: 'instrument'; query: string }
    /** `:addpart [filter]` picks an instrument for a new part below the cursor's */
    | { name: 'addPart'; query: string }
    | { name: 'deletePart' }
    /** `:parts` opens the parts list, to add, delete and reorder parts */
    | { name: 'parts' }
    | { name: 'rename'; text: string }
    /** `:title Aqua Game` names the whole score */
    | { name: 'title'; text: string }
    | { name: 'clef'; clef: Clef }
    /** `:time 3/4`, `:key Eb`, `:tempo q=90`: from the cursor's measure on, in every part */
    | { name: 'timeSignature'; value: TimeSignature }
    | { name: 'keySignature'; value: KeySignature }
    /** Without a beat, the tempo keeps counting the one it had */
    | { name: 'tempo'; bpm: number; beat?: Duration }
    /** `:mixer` opens the mixer, to set every part's volume */
    | { name: 'mixer' }
    /** `:recent [filter]` picks a score opened before, to open again */
    | { name: 'recent'; query: string }
    /** `:help [topic]` opens the manual, at the first match for the topic */
    | { name: 'help'; query: string };

/** The commands the editor runs itself; the rest need files, dialogs or the window */
/** What `:export` can write */
/** `musanim` is a video too: the music as colored bars of light, not the score */
export const EXPORT_FORMATS = ['mp3', 'mp4', 'musanim', 'midi'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Each format's file extension */
export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = { mp3: 'mp3', mp4: 'mp4', musanim: 'mp4', midi: 'mid' };

const EDIT_COMMANDS = [
    'instrument',
    'addPart',
    'deletePart',
    'parts',
    'rename',
    'title',
    'clef',
    'timeSignature',
    'keySignature',
    'tempo',
    'mixer',
    'recent',
    'help',
] as const;

export type EditCommand = Extract<Command, { name: (typeof EDIT_COMMANDS)[number] }>;

export const isEditCommand = (command: Command): command is EditCommand =>
    (EDIT_COMMANDS as readonly string[]).includes(command.name);

/** The commands for files and the window, which `runCommand` runs */
export type FileCommand = Extract<Command, { name: 'write' | 'edit' | 'new' | 'quit' | 'writeQuit' }>;

export const isFileCommand = (command: Command): command is FileCommand =>
    ['write', 'edit', 'new', 'quit', 'writeQuit'].includes(command.name);

const NAMES: Record<string, Command['name']> = {
    w: 'write',
    write: 'write',
    e: 'edit',
    edit: 'edit',
    enew: 'new',
    q: 'quit',
    quit: 'quit',
    wq: 'writeQuit',
    x: 'writeQuit',
    export: 'export',
    soundfont: 'soundfont',
    sf: 'soundfont',
    addsoundfont: 'addSoundfont',
    addsf: 'addSoundfont',
    delsoundfont: 'deleteSoundfont',
    delsf: 'deleteSoundfont',
    soundfonts: 'listSoundfonts',
    sfs: 'listSoundfonts',
    instrument: 'instrument',
    inst: 'instrument',
    addpart: 'addPart',
    delpart: 'deletePart',
    parts: 'parts',
    rename: 'rename',
    title: 'title',
    clef: 'clef',
    time: 'timeSignature',
    key: 'keySignature',
    tempo: 'tempo',
    mixer: 'mixer',
    mix: 'mixer',
    recent: 'recent',
    help: 'help',
    h: 'help',
};

/** The command a name typed after `:` stands for, like `w` for `write` */
export const commandName = (typed: string): Command['name'] | undefined => NAMES[typed];


export function parseCommand(text: string): Command | { error: string } {
    const match = /^\s*([a-z]+)(!?)\s*(.*?)\s*$/.exec(text);
    const typedName = match?.[1] ?? '';
    const name = NAMES[typedName];
    if (!match || !name) return { error: `Not a command: ${text.trim()}` };
    const force = match[2] === '!';
    const args = match[3] ?? '';
    const path = args || undefined;

    switch (name) {
        case 'quit':
        case 'new':
            return args ? { error: `:${typedName} takes no file name` } : { name, force };
        case 'deletePart':
        case 'parts':
        case 'listSoundfonts':
        case 'mixer':
            return args ? { error: `:${typedName} takes nothing after it` } : { name };
        case 'writeQuit':
        case 'soundfont':
        case 'addSoundfont':
            return { name, path };
        case 'deleteSoundfont':
            return args ? { name, which: args } : { error: 'Remove which? :delsf 2, or :delsf and its name' };
        case 'instrument':
        case 'addPart':
        case 'recent':
        case 'help':
            return { name, query: args };
        case 'rename':
            return args ? { name, text: args } : { error: 'Rename to what? :rename Violin I' };
        case 'title':
            return args ? { name, text: args } : { error: 'Title it what? :title Aqua Game' };
        case 'clef':
            return isClef(args) ? { name, clef: args } : { error: `Expected :clef ${CLEFS.join(', ')}` };
        case 'timeSignature': {
            const value = parseTimeSignature(args);
            return value ? { name, value } : { error: 'Expected a time signature, like :time 3/4' };
        }
        case 'keySignature': {
            const value = parseKeySignature(args);
            return value ? { name, value } : { error: 'Expected a key, like :key D, :key Bb, :key F#m or :key 2#' };
        }
        case 'tempo': {
            const value = parseTempo(args);
            return value ? { name, ...value } : { error: 'Expected a tempo, like :tempo 120 or :tempo q.=60' };
        }
        case 'export': {
            const [typed = '', ...rest] = args.split(/\s+/);
            // `mid` works too, being the extension
            const format = typed === 'mid' ? 'midi' : typed;
            if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
                return { error: 'Expected :export mp3, mp4, musanim or midi [file]' };
            }
            return { name, format: format as ExportFormat, path: rest.join(' ') || undefined, force };
        }
        case 'write':
        case 'edit':
            return { name, path, force };
    }
}
