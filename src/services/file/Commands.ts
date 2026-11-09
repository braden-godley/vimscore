/**
 * The `:` commands for files, like vim's: `:w`, `:e`, `:q` and friends. Running one needs the
 * filesystem and dialogs, which belong to Electron's main process, so they come in as a
 * `FileHost` and this stays testable.
 */

import { Composition, newComposition } from '../composition/Composition';
import { Session, startSession } from '../session/Session';
import { FileCommand } from '../editor/CommandLine';
import { readMuseScore } from '../import/MuseScore';
import { readMidi } from '../import/Midi';
import { readOrganya } from '../import/Organya';
import { EXTENSION, readScore, writeScore } from './ScoreFile';

/** What the app gives the commands to work with files */
export interface FileHost {
    /** Absolute, with `~` expanded; relative paths are from `base` (a file's folder) or home */
    resolve(path: string, base?: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    readBinary(path: string): Promise<ArrayBuffer>;
    write(path: string, text: string): Promise<void>;
    /** Ask with the system dialog; undefined if cancelled */
    chooseSavePath(suggested?: string): Promise<string | undefined>;
    chooseOpenPath(): Promise<string | undefined>;
    close(): void;
}

/** The score being edited and where it lives */
export interface Document {
    session: Session;
    /** Where it was last read from or written to; undefined for a score never saved */
    path?: string;
    /** The version last read or written, to tell whether there are changes; undefined if never */
    saved?: Composition;
    /** Where saving should suggest, for a score read from another program's file */
    suggestedPath?: string;
}

export function newDocument(composition: Composition = newComposition()): Document {
    const session = startSession(composition);
    return { session, saved: session.composition };
}

export const isModified = ({ session, saved }: Document) => session.composition !== saved;

/** What running a command did: the document after it, and a line for the status bar */
export interface CommandResult {
    document: Document;
    message: string;
    error?: boolean;
}

const NOT_SAVED = 'No write since last change (add ! to override)';

const measureCount = ({ measures }: Composition) => `${measures.length} measure${measures.length === 1 ? '' : 's'}`;
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string | undefined) => path?.replace(/[\\/][^\\/]*$/, '');

/** Adds the extension to a name typed without one, like vim adding nothing but kinder */
function withExtension(path: string): string {
    return /\.[^\\/.]+$/.test(path) ? path : `${path}.${EXTENSION}`;
}

/** The score a name typed after `:e` or `:new` means: from the open score's folder, as a score */
export function scorePath(document: Document, host: FileHost, typed: string): Promise<string> {
    return host.resolve(withExtension(typed), folder(document.path));
}

async function write(document: Document, host: FileHost, typed: string | undefined, force: boolean) {
    let path: string | undefined;
    if (typed) {
        path = await host.resolve(withExtension(typed), folder(document.path));
        // Like vim, writing to a new name won't replace a file that's there without !
        if (path !== document.path && !force && (await host.exists(path))) {
            return { document, message: `"${fileName(path)}" exists (add ! to override)`, error: true };
        }
    } else {
        path = document.path ?? (await host.chooseSavePath(document.suggestedPath));
        if (!path) return { document, message: 'Not written' };
    }

    const { composition } = document.session;
    await host.write(path, writeScore(composition));
    return {
        document: { ...document, path, saved: composition, suggestedPath: undefined },
        message: `"${fileName(path)}" ${measureCount(composition)} written`,
    };
}

/** Other programs' files that are read by converting them, by their extensions */
const IMPORTERS: { extension: RegExp; read: (data: Uint8Array) => Composition | { error: string } }[] = [
    { extension: /\.msc[zx]$/i, read: readMuseScore },
    { extension: /\.midi?$/i, read: readMidi },
    { extension: /\.org$/i, read: readOrganya },
];

/**
 * Opens a MuseScore, MIDI or Organya file as a new score. It isn't saved anywhere yet, so `:w` asks
 * where, suggesting a `.vimscore` beside it rather than writing over the file it came from. It
 * plays through the soundfonts `blank` scores start with.
 */
async function importScore(
    document: Document,
    host: FileHost,
    path: string,
    { extension, read }: (typeof IMPORTERS)[number],
    blank: () => Composition,
) {
    let data: ArrayBuffer;
    try {
        data = await host.readBinary(path);
    } catch {
        return { document, message: `Can't open "${fileName(path)}"`, error: true };
    }
    const result = read(new Uint8Array(data));
    if ('error' in result) return { document, message: `"${fileName(path)}": ${result.error}`, error: true };

    // A score without a title of its own goes by its file's name
    const title = result.title === 'Untitled' ? fileName(path).replace(extension, '') : result.title;
    const composition = { ...result, title, soundfonts: blank().soundfonts };
    const suggestedPath = path.replace(extension, `.${EXTENSION}`);
    return {
        document: { session: newDocument(composition).session, suggestedPath },
        message: `"${fileName(path)}" imported, ${measureCount(composition)}; :w to save it as a ${EXTENSION} file`,
    };
}

async function edit(
    document: Document,
    host: FileHost,
    typed: string | undefined,
    force: boolean,
    blank: () => Composition,
) {
    if (isModified(document) && !force) return { document, message: NOT_SAVED, error: true };
    // `:e` alone reads the current file again, or asks for one if there isn't one yet
    const path = typed
        ? await scorePath(document, host, typed)
        : (document.path ?? (await host.chooseOpenPath()));
    if (!path) return { document, message: 'Nothing opened' };

    const importer = IMPORTERS.find(({ extension }) => extension.test(path));
    if (importer) return importScore(document, host, path, importer, blank);

    let text: string;
    try {
        text = await host.read(path);
    } catch {
        return { document, message: `Can't open "${fileName(path)}"`, error: true };
    }
    const composition = readScore(text);
    if ('error' in composition) return { document, message: `"${fileName(path)}": ${composition.error}`, error: true };

    const opened = newDocument(composition);
    return { document: { ...opened, path }, message: `"${fileName(path)}" ${measureCount(composition)}` };
}

/** `blank` is what `:enew` starts from, so the app can give it default soundfonts */
export async function runCommand(
    command: FileCommand,
    document: Document,
    host: FileHost,
    blank: () => Composition = newComposition,
): Promise<CommandResult> {
    try {
        switch (command.name) {
            case 'write':
                return await write(document, host, command.path, command.force);
            case 'edit':
                return await edit(document, host, command.path, command.force, blank);
            case 'new':
                if (isModified(document) && !command.force) return { document, message: NOT_SAVED, error: true };
                return { document: newDocument(blank()), message: 'New score' };
            case 'quit':
                if (isModified(document) && !command.force) return { document, message: NOT_SAVED, error: true };
                host.close();
                return { document, message: '' };
            case 'writeQuit': {
                const written = await write(document, host, command.path, false);
                if (!written.error && !isModified(written.document)) host.close();
                return written;
            }
        }
    } catch (error) {
        return { document, message: `Error: ${(error as Error).message}`, error: true };
    }
}
