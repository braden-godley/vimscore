import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { sessionKey } from '../session/Session';
import { FileCommand, parseCommand } from '../editor/CommandLine';
import { Document, FileHost, isModified, newDocument, runCommand } from './Commands';
import { writeScore } from './ScoreFile';

describe('parseCommand', () => {
    it('reads vim file commands', () => {
        expect(parseCommand('w')).toEqual({ name: 'write', path: undefined, force: false });
        expect(parseCommand('w! ~/song')).toEqual({ name: 'write', path: '~/song', force: true });
        expect(parseCommand('e  scores/a b.vimscore ')).toEqual({ name: 'edit', path: 'scores/a b.vimscore', force: false });
        expect(parseCommand('q!')).toEqual({ name: 'quit', force: true });
        expect(parseCommand('x')).toEqual({ name: 'writeQuit', path: undefined });
        expect(parseCommand('enew')).toEqual({ name: 'new', force: false });
    });

    it('rejects anything else', () => {
        expect(parseCommand('frob')).toEqual({ error: 'Not a command: frob' });
        expect(parseCommand('q file')).toEqual({ error: ':q takes no file name' });
    });
});

/** A filesystem in a map, with home at /home and dialogs that answer as told */
interface FakeHost extends FileHost {
    files: Record<string, string>;
    closed: boolean;
    /** What the save dialog was last asked to suggest */
    suggested?: string;
}

function fakeHost(files: Record<string, string> = {}, answers: { save?: string; open?: string } = {}): FakeHost {
    const host: FakeHost = {
        files: { ...files },
        closed: false,
        resolve: async (path: string, base = '/home') =>
            path.startsWith('~/') ? `/home/${path.slice(2)}` : path.startsWith('/') ? path : `${base}/${path}`,
        exists: async (path: string) => path in host.files,
        read: async (path: string) => {
            if (!(path in host.files)) throw new Error('missing');
            return host.files[path]!;
        },
        readBinary: async (path: string) => {
            if (!(path in host.files)) throw new Error('missing');
            return new TextEncoder().encode(host.files[path]!).buffer as ArrayBuffer;
        },
        write: async (path: string, text: string) => {
            host.files[path] = text;
        },
        chooseSavePath: async (suggested?: string) => {
            host.suggested = suggested;
            return answers.save;
        },
        chooseOpenPath: async () => answers.open,
        close: () => {
            host.closed = true;
        },
    };
    return host;
}

const run = (text: string, document: Document, host: FileHost) => runCommand(parseCommand(text) as FileCommand, document, host);

/** A document with an edit made: the first note deleted */
const edited = (document: Document): Document => {
    const session = ['d', 'd'].reduce((current, key) => sessionKey(current, key).session, document.session);
    return { ...document, session };
};

describe('runCommand', () => {
    const example = () => newDocument(exampleComposition);

    it('writes, adding the extension, and remembers where', async () => {
        const host = fakeHost();
        const result = await run('w song', edited(example()), host);
        expect(result.message).toBe('"song.vimscore" 4 measures written');
        expect(result.document.path).toBe('/home/song.vimscore');
        expect(isModified(result.document)).toBe(false);
        expect(host.files['/home/song.vimscore']).toBe(writeScore(result.document.session.composition));

        // Then :w goes back to the same file
        const again = await run('w', edited(result.document), host);
        expect(again.document.path).toBe('/home/song.vimscore');
    });

    it('asks where to write a score that has never been saved', async () => {
        const saved = await run('w', example(), fakeHost({}, { save: '/music/a.vimscore' }));
        expect(saved.document.path).toBe('/music/a.vimscore');
        expect((await run('w', example(), fakeHost())).message).toBe('Not written');
    });

    it("won't write over another file without !", async () => {
        const host = fakeHost({ '/home/taken.vimscore': 'x' });
        expect(await run('w taken', example(), host)).toMatchObject({ error: true, message: '"taken.vimscore" exists (add ! to override)' });
        expect((await run('w! taken', example(), host)).error).toBeUndefined();
    });

    it('opens a file, relative to the current one', async () => {
        const host = fakeHost({ '/music/b.vimscore': writeScore(exampleComposition) });
        const document = { ...example(), path: '/music/a.vimscore' };
        const opened = await run('e b', document, host);
        // The file's own measures; the empty one to write into comes after
        expect(opened.message).toBe('"b.vimscore" 3 measures');
        expect(opened.document.path).toBe('/music/b.vimscore');
        expect(isModified(opened.document)).toBe(false);
    });

    it('says what is wrong with a file it cannot read', async () => {
        const host = fakeHost({ '/home/bad.vimscore': '{"format":"other"}' });
        expect(await run('e bad', example(), host)).toMatchObject({ error: true, message: '"bad.vimscore": not a vimscore file' });
        expect(await run('e missing', example(), host)).toMatchObject({ error: true, message: 'Can\'t open "missing.vimscore"' });
    });

    it('protects unsaved changes from :e, :enew and :q unless forced', async () => {
        const host = fakeHost({ '/home/b.vimscore': writeScore(exampleComposition) });
        const changed = edited(example());
        for (const command of ['e b', 'enew', 'q']) {
            expect(await run(command, changed, host)).toMatchObject({
                error: true,
                message: 'No write since last change (add ! to override)',
            });
        }
        expect(host.closed).toBe(false);
        expect((await run('e! b', changed, host)).document.path).toBe('/home/b.vimscore');
        await run('q!', changed, host);
        expect(host.closed).toBe(true);
    });

    it('writes then closes with :wq', async () => {
        const host = fakeHost();
        await run('wq song', edited(example()), host);
        expect(host.files['/home/song.vimscore']).toBeDefined();
        expect(host.closed).toBe(true);
    });

    it('counts undoing back to the saved version as unchanged', () => {
        const document = example();
        const undone = ['d', 'd', 'u'].reduce((current, key) => sessionKey(current, key).session, document.session);
        expect(isModified({ ...document, session: undone })).toBe(false);
    });
});

describe('opening MuseScore files', () => {
    const MSCX = `<museScore version="3.02"><Score>
        <Part><Staff id="1"/><trackName>Flute</trackName><Instrument><Channel><program value="73"/></Channel></Instrument></Part>
        <Staff id="1"><Measure><voice>
            <TimeSig><sigN>2</sigN><sigD>4</sigD></TimeSig>
            <Chord><durationType>half</durationType><Note><pitch>72</pitch></Note></Chord>
        </voice></Measure></Staff>
    </Score></museScore>`;

    it('imports them as a new, unsaved score, and :w suggests a vimscore beside them', async () => {
        const host = fakeHost({ '/music/tune.mscx': MSCX }, { save: '/music/tune.vimscore' });
        const opened = await run('e /music/tune.mscx', newDocument(), host);
        expect(opened.message).toBe('"tune.mscx" imported, 1 measure; :w to save it as a vimscore file');
        expect(opened.document.path).toBeUndefined();
        expect(isModified(opened.document)).toBe(true);
        expect(opened.document.session.composition.parts[0]).toMatchObject({ name: 'Flute', program: 73 });
        // It has no title, so it takes the file's name
        expect(opened.document.session.composition.title).toBe('tune');

        const saved = await run('w', opened.document, host);
        expect(host.suggested).toBe('/music/tune.vimscore');
        expect(saved.document).toMatchObject({ path: '/music/tune.vimscore', suggestedPath: undefined });
        expect(host.files['/music/tune.mscx']).toBe(MSCX);
    });

    it('gives new imports the soundfonts new scores get', async () => {
        const host = fakeHost({ '/music/tune.mscx': MSCX });
        const soundfonts = [{ filePath: '/sf/strings.sf2' }, { filePath: '/sf/default.sf2' }];
        const blank = () => ({ ...exampleComposition, soundfonts });
        const opened = await runCommand({ name: 'edit', path: '/music/tune.mscx', force: false }, newDocument(), host, blank);
        expect(opened.document.session.composition.soundfonts).toEqual(soundfonts);
    });

    it('says what is wrong with one it cannot read', async () => {
        const host = fakeHost({ '/music/old.mscx': '<museScore version="2.06"><Score/></museScore>' });
        expect((await run('e /music/old.mscx', newDocument(), host)).message).toBe(
            '"old.mscx": MuseScore 2.06 files aren\'t supported, only 3 and 4',
        );
    });
});
