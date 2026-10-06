/** Reading what's typed on the `:` command line into a command */

import { Duration } from '../duration/Duration';
import { KeySignature } from '../key/KeySignature';
import { TimeSignature } from '../measure/Measure';
import { Clef } from '../part/Part';
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
    /** `:soundfont [path]`, asking with a dialog when there's no path */
    | { name: 'soundfont'; path?: string }
    /** `:instrument [filter]` opens the picker for the cursor's part, filtered as typed */
    | { name: 'instrument'; query: string }
    /** `:addpart [filter]` picks an instrument for a new part below the cursor's */
    | { name: 'addPart'; query: string }
    | { name: 'deletePart' }
    | { name: 'rename'; text: string }
    /** `:title Aqua Game` names the whole score */
    | { name: 'title'; text: string }
    | { name: 'clef'; clef: Clef }
    /** `:time 3/4`, `:key Eb`, `:tempo q=90`: from the cursor's measure on, in every part */
    | { name: 'timeSignature'; value: TimeSignature }
    | { name: 'keySignature'; value: KeySignature }
    /** Without a beat, the tempo keeps counting the one it had */
    | { name: 'tempo'; bpm: number; beat?: Duration }
    /** `:volume 60`: the cursor's part plays at 60% from its beat on */
    | { name: 'volume'; percent: number };

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
    'rename',
    'title',
    'clef',
    'timeSignature',
    'keySignature',
    'tempo',
    'volume',
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
    instrument: 'instrument',
    inst: 'instrument',
    addpart: 'addPart',
    delpart: 'deletePart',
    rename: 'rename',
    title: 'title',
    clef: 'clef',
    time: 'timeSignature',
    key: 'keySignature',
    tempo: 'tempo',
    volume: 'volume',
    vol: 'volume',
};

const CLEFS: Clef[] = ['treble', 'bass'];

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
            return args ? { error: `:${typedName} takes nothing after it` } : { name };
        case 'writeQuit':
        case 'soundfont':
            return { name, path };
        case 'instrument':
        case 'addPart':
            return { name, query: args };
        case 'rename':
            return args ? { name, text: args } : { error: 'Rename to what? :rename Violin I' };
        case 'title':
            return args ? { name, text: args } : { error: 'Title it what? :title Aqua Game' };
        case 'clef':
            return CLEFS.includes(args as Clef) ? { name, clef: args as Clef } : { error: `Expected :clef ${CLEFS.join(' or ')}` };
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
        case 'volume': {
            const match = /^(\d{1,3})%?$/.exec(args);
            const percent = match ? Number(match[1]) : NaN;
            return percent <= 100 ? { name, percent } : { error: 'Expected a volume from 0 to 100, like :volume 60' };
        }
        case 'write':
        case 'edit':
            return { name, path, force };
    }
}
