import { describe, expect, it } from 'vitest';
import { newComposition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { Session, sessionKey, startSession } from './Session';
import { midi, spell } from '../pitch/Pitch';

function type(keys: string[], session: Session = startSession(exampleComposition)): Session {
    return keys.reduce((current, key) => sessionKey(current, key).session, session);
}

/** The melody's first chord, as pitches, or null for a rest */
const firstChord = ({ composition }: Session) => {
    const event = composition.parts[0]!.measures[0]!.voices[0]!.events[0]!;
    return event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : null;
};

describe('undo and redo', () => {
    const start = startSession(exampleComposition);

    it('undoes an edit, back to the version and cursor from before it', () => {
        const undone = type(['l', 'd', 'l', 'h', 'u']);
        expect(undone.composition).toEqual(start.composition);
        expect(undone.editor.cursor.leaf).toBe(1);
    });

    it('redoes with U, back to the cursor after the edit', () => {
        const redone = type(['d', 'd', 'u', 'U']);
        expect(firstChord(redone)).toEqual([60, 64]);
        expect(redone.editor.cursor.note).toBe(1);
    });

    it('steps through several edits, with counts', () => {
        const edits = ['d', 'd', 'd', 'd', 'd', 'd'];
        expect(firstChord(type([...edits, 'u']))).toEqual([60]);
        expect(firstChord(type([...edits, '2', 'u']))).toEqual([60, 64]);
        expect(firstChord(type([...edits, '9', 'u', '2', 'U']))).toEqual([60]);
    });

    it('does nothing with nothing to undo or redo', () => {
        expect(type(['u']).composition).toEqual(start.composition);
        expect(firstChord(type(['d', 'd', 'U']))).toEqual([60, 64]);
    });

    it('forgets what was undone once something new is edited', () => {
        expect(firstChord(type(['d', 'd', 'u', 'l', 'd', 'd', 'h', 'U']))).toEqual([60, 64, 67]);
    });

    it('undoes everything entered in one stay in insert mode at once', () => {
        for (const mode of ['i', 'a']) {
            const entered = type([mode, 'k', '<Space>', 'k', '<Space>', '<Esc>']);
            expect(entered.composition).not.toEqual(start.composition);
            expect(type(['u'], entered).composition).toEqual(start.composition);
        }
    });

    it('gives each stay in insert mode its own step', () => {
        const twice = type(['i', 'k', '<Space>', '<Esc>', 'l', 'i', 'k', '<Space>', '<Esc>']);
        const once = type(['u'], twice);
        expect(firstChord(once)).toEqual([60, 64, 67, 69]);
        expect(type(['u'], once).composition).toEqual(start.composition);
    });

});

describe('changes for every part', () => {
    const command = (text: string) => [':', ...text, '<CR>'];

    it('sets the time signature from the cursor measure with :time, re-barring', () => {
        const changed = type(command('time 3/4'));
        expect(changed.editor.mode).toBe('normal');
        expect(changed.composition.measures[0]?.timeSignature).toEqual({ beats: 3, beatValue: 4 });
        // C-E-G q, G-B-D q, C-E-G h re-barred into 3/4 spills a quarter into a new measure
        expect(changed.composition.parts[0]!.measures[1]!.voices[0]!.events[0]).toMatchObject({ kind: 'chord' });
        expect(changed.editor.cursor).toMatchObject({ measure: 0, leaf: 0 });
    });

    it('sets the key with :key and the tempo with :tempo, from the cursor measure', () => {
        expect(type(['}', ...command('key Eb')]).composition.measures[1]?.keySignature).toEqual({ fifths: -3 });
        expect(type(['}', ...command('tempo q=90')]).composition.measures[1]?.tempo).toEqual({
            bpm: 90,
            beat: { base: 4, dots: 0 },
        });
        // A bare number keeps counting dotted quarters in the 6/8 measure
        expect(type(['3', 'G', ...command('tempo 72')]).composition.measures[2]?.tempo).toEqual({
            bpm: 72,
            beat: { base: 4, dots: 1 },
        });
    });

    it('takes the typed character for shifted keys', () => {
        const sharp = [[':'], ...[...'key F'].map((key) => [key === ' ' ? '<Space>' : key]), ['<S-3>', '#'], ['<CR>']].reduce(
            (current, [key, text]) => sessionKey(current, key!, { text }).session,
            startSession(exampleComposition),
        );
        expect(sharp.composition.measures[0]?.keySignature).toEqual({ fifths: 6 });
    });

    it('keeps the command line open with an error for something it cannot read', () => {
        const wrong = type(command('time 3/5'));
        expect(wrong.editor.mode).toBe('command');
        expect(wrong.editor.commandLine?.error).toBe('Expected a time signature, like :time 3/4');
        // Typing clears the error, and backspace edits
        const fixed = type(['<BS>', '4'], wrong);
        expect(fixed.editor.commandLine).toEqual({ text: 'time 3/4' });
    });

    it('cancels with escape, or backspacing past the start', () => {
        expect(type([':', 't', '<Esc>']).editor).toMatchObject({ mode: 'normal', commandLine: undefined });
        expect(type([':', '<BS>']).editor.mode).toBe('normal');
    });

    it('no longer uses m chords', () => {
        expect(type(['m', 't']).editor.mode).toBe('normal');
    });

    it('can be undone', () => {
        const changed = type(command('time 3/4'));
        expect(type(['u'], changed).composition).toEqual(startSession(exampleComposition).composition);
    });
});

describe('a new composition', () => {
    it('starts as one empty measure on two staves, ready to write in', () => {
        const session = startSession(newComposition());
        expect(session.composition.measures).toHaveLength(1);
        expect(session.composition.parts.map(({ clef }) => clef)).toEqual(['treble', 'bass']);
        expect(session.editor.cursor).toEqual({ part: 0, measure: 0, voice: 0, leaf: 0, note: 0 });

        // Placing a whole note fills the measure, and a new empty one follows
        const written = type(['i', '<S-6>', '<Space>'], session);
        expect(written.composition.measures).toHaveLength(2);
        expect(written.composition.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            kind: 'chord',
            notes: [{ pitch: spell(71) }],
        });
    });
});

describe('yanking and putting across edits', () => {
    const melody = ({ composition }: Session, measure: number) =>
        composition.parts[0]!.measures[measure]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : event.kind,
        );

    it('moves a note with dd and p', () => {
        expect(melody(type(['d', 'd', 'l', 'P']), 0)).toEqual([[60, 64], [55, 59, 62, 67], [60, 64, 67]]);
    });

    it('moves measures with Vd and p', () => {
        // Bar 1 of the melody, cleared and put back over bar 2's 3/4, spilling into bar 3
        const moved = type(['V', 'd', 'p']);
        expect(melody(moved, 0)).toEqual(['rest']);
        expect(melody(moved, 1)).toEqual([[60, 64, 67], [55, 59, 62], [60, 64, 67]]);
    });

    it('undoes a put in one step', () => {
        const put = type(['y', 'y', 'l', 'p', 'l', 'p']);
        expect(firstChord(type(['u', 'u'], put))).toEqual([60, 64, 67]);
        expect(type(['u', 'u'], put).composition).toEqual(startSession(exampleComposition).composition);
    });
});

describe('parts and instruments', () => {
    const command = (text: string) => [':', ...text, '<CR>'];
    const names = (session: Session) => session.composition.parts.map(({ name }) => name);

    it('adds a part below the cursor with the picker, moving into it', () => {
        const added = type([...command('addpart cello'), '<CR>']);
        expect(names(added)).toEqual(['Melody', 'Cello', 'Bass']);
        expect(added.composition.parts[1]).toMatchObject({ clef: 'bass', program: 42 });
        expect(added.editor).toMatchObject({ mode: 'normal', cursor: { part: 1, measure: 0 } });
        expect(names(type(['u'], added))).toEqual(['Melody', 'Bass']);
    });

    it('changes the cursor part’s instrument, playing each one moved to', () => {
        const picking = type([...command('instrument'), 'v', 'i', 'o']);
        expect(picking.editor).toMatchObject({ mode: 'picker', picker: { query: 'vio', selected: 0 } });
        expect(sessionKey(picking, '<Down>').effect).toMatchObject({
            kind: 'audition',
            instrument: { name: 'Viola' },
            pitch: 60,
        });

        const chosen = type(['<Down>', '<CR>'], picking);
        expect(chosen.composition.parts[0]).toMatchObject({ name: 'Melody', program: 41 });
        expect(type(['<Esc>'], picking).composition).toBe(picking.composition);
    });

    it("offers the soundfont's instruments when given them", () => {
        const kit = { name: 'Jazz Kit', program: 32, bank: 128, drums: true };
        const opened = type(command('instrument'));
        const chosen = sessionKey(sessionKey(opened, 'j', { instruments: [kit] }).session, '<CR>', { instruments: [kit] });
        expect(chosen.session.composition.parts[0]).toMatchObject({ program: 32, bank: 128, drums: true });
    });

    it('deletes, renames and sets clefs, all undoable', () => {
        expect(names(type(command('delpart')))).toEqual(['Bass']);
        expect(names(type(['<C-j>', ...command('delpart')]))).toEqual(['Melody']);
        expect(names(type(command('rename Lead')))).toEqual(['Lead', 'Bass']);
        expect(type(command('clef bass')).composition.parts[0]?.clef).toBe('bass');
        expect(names(type([...command('rename Lead'), 'u']))).toEqual(['Melody', 'Bass']);
    });

    it('hands :soundfont to the app, which loads the file', () => {
        const opened = type([':', ...'sf ~/a.sf2']);
        expect(sessionKey(opened, '<CR>').effect).toEqual({ kind: 'command', command: { name: 'soundfont', path: '~/a.sf2' } });
    });
});

describe('changing a selection', () => {
    const melody = ({ composition }: Session, measure: number) =>
        composition.parts[0]!.measures[measure]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : event.kind,
        );

    it('deletes it and inserts from its first beat, starting from the note that was there', () => {
        // The second and third chords of the first measure
        const changing = type(['l', '<C-v>', 'l', 'c']);
        expect(changing.editor.mode).toBe('insert');
        expect(changing.editor.cursor).toMatchObject({ part: 0, measure: 0, leaf: 1 });
        expect(changing.editor.phantom).toMatchObject({ pitch: spell(62), duration: { base: 4, dots: 0 } });
        expect(melody(changing, 0)).toEqual([[60, 64, 67], 'rest', 'rest']);
        expect(changing.editor.register).toMatchObject({ kind: 'clip' });
    });

    it('works on whole measures of one staff, and one undo takes back the change and what was entered', () => {
        // The phantom starts on the measure's top G; k raises it to A
        const changed = type(['V', 'c', 'k', '<Space>', '<Esc>']);
        expect(melody(changed, 0)).toEqual([[69], 'rest', 'rest']);
        expect(changed.composition.parts[1]!.measures[0]).toEqual(exampleComposition.parts[1]!.measures[0]);
        expect(type(['u'], changed).composition).toEqual(startSession(exampleComposition).composition);
    });

    it('does nothing across staves', () => {
        const across = type(['<C-v>', '<C-j>', 'c']);
        expect(across.editor.mode).toBe('visualBlock');
        expect(across.composition).toEqual(startSession(exampleComposition).composition);
    });
});

describe('switching insert modes', () => {
    it('toggles with m, keeping the phantom, and undoes as one stay', () => {
        const melody = type(['i', 'k', 'm']);
        expect(melody.editor).toMatchObject({ mode: 'insertMelody', phantom: { pitch: spell(69) } });
        expect(type(['m'], melody).editor.mode).toBe('insert');
        expect(type(['A'], melody).editor.mode).toBe('insertMelody');

        // Placing now moves on; switching back stays put
        const placed = type(['<Space>', 'm', '<Space>', '<Esc>'], melody);
        expect(placed.editor.cursor).toMatchObject({ measure: 0, leaf: 1 });
        expect(type(['u'], placed).composition).toEqual(startSession(exampleComposition).composition);
    });
});

describe('entering rests', () => {
    const melody = ({ composition }: Session, measure: number) =>
        composition.parts[0]!.measures[measure]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : `r/${event.kind === 'rest' ? event.duration.base : ''}`,
        );

    it('puts a rest as long as the phantom with <S-Space>, staying put in insert mode', () => {
        const rested = type(['i', '<S-Space>']);
        expect(melody(rested, 0)).toEqual(['r/4', [55, 59, 62], [60, 64, 67]]);
        expect(rested.editor.cursor).toMatchObject({ measure: 0, leaf: 0 });

        // A half-note phantom writes over the next chord too
        expect(melody(type(['i', '<S-5>', '<S-Space>']), 0)).toEqual(['r/2', [60, 64, 67]]);
    });

    it('moves on to the next beat in melody mode', () => {
        const rested = type(['a', '<S-Space>', '<S-Space>']);
        expect(melody(rested, 0)).toEqual(['r/4', 'r/4', [60, 64, 67]]);
        expect(rested.editor.cursor).toMatchObject({ measure: 0, leaf: 2 });
    });

    it('just moves on over a rest that is already that long', () => {
        // The last melody event is an eighth rest, and the phantom copies it
        const moved = type(['3', 'G', 'l', 'l', 'l', 'a', '<S-Space>']);
        expect(moved.editor.cursor).toMatchObject({ measure: 3, leaf: 0 });
        expect(moved.composition).toEqual(startSession(exampleComposition).composition);
    });
});

describe('undo in insert mode', () => {
    const start = startSession(exampleComposition);
    /** The melody's first measure, as pitches per chord, with null for rests */
    const bar = ({ composition }: Session) =>
        composition.parts[0]!.measures[0]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : null,
        );

    it('takes back the last note placed, staying in insert mode', () => {
        const twice = type(['i', 'k', '<Space>', 'k', '<Space>']);
        expect(bar(twice)[0]).toEqual([60, 64, 67, 69, 71]);
        const once = type(['u'], twice);
        expect(once.editor.mode).toBe('insert');
        expect(bar(once)[0]).toEqual([60, 64, 67, 69]);
        expect(bar(type(['u'], once))[0]).toEqual([60, 64, 67]);
    });

    it('steps back in melody mode, to where the note was', () => {
        const entered = type(['a', 'k', '<Space>', '<Space>']);
        expect(entered.editor.cursor).toMatchObject({ leaf: 2 });
        const undone = type(['u'], entered);
        expect(undone.editor.cursor).toMatchObject({ leaf: 1 });
        expect(bar(undone)[1]).toEqual([55, 59, 62]);
        expect(type(['2', 'u'], entered).editor.cursor).toMatchObject({ leaf: 0 });
    });

    it('leaves nothing to undo once every note is taken back', () => {
        const undone = type(['i', 'k', '<Space>', 'u', 'u', '<Esc>']);
        expect(undone.composition).toEqual(start.composition);
        expect(undone.history.undo).toEqual([]);
    });

    it('stops at the start of the stay, keeping a visual c deletion', () => {
        const changed = type(['l', '<C-v>', 'c', 'k', '<Space>', 'u', 'u']);
        expect(bar(changed)).toEqual([[60, 64, 67], null, [60, 64, 67]]);
        // The deletion is still one normal undo away
        expect(type(['<Esc>', 'u'], changed).composition).toEqual(start.composition);
    });

    it('leaves the rest of the stay to one undo in normal mode', () => {
        const entered = type(['i', 'k', '<Space>', 'k', '<Space>', 'u', '<Esc>']);
        expect(bar(entered)[0]).toEqual([60, 64, 67, 69]);
        expect(type(['u'], entered).composition).toEqual(start.composition);
    });
});

describe(':volume', () => {
    it('marks the cursor part from its beat', () => {
        const marked = type(['l', ':', ...'volume 10', '<CR>']);
        expect(marked.composition.parts[0]!.measures[0]!.volumes).toEqual([{ offset: { num: 1, den: 4 }, percent: 10 }]);
        expect(type(['u'], marked).composition).toEqual(startSession(exampleComposition).composition);
    });

    it('takes 0 to 100, with or without %', () => {
        expect(type([':', ...'vol 55%', '<CR>']).composition.parts[0]!.measures[0]!.volumes?.[0]?.percent).toBe(55);
        expect(type([':', ...'volume 101', '<CR>']).editor.commandLine?.error).toBe(
            'Expected a volume from 0 to 100, like :volume 60',
        );
    });
});

describe('repeat keys', () => {
    it('rs and re toggle repeats at the cursor measure, undoably', () => {
        const marked = type(['}', 'r', 's', '}', 'r', 'e']);
        expect(marked.composition.measures[1]).toMatchObject({ repeatStart: true });
        expect(marked.composition.measures[2]).toMatchObject({ repeatEnd: true });
        expect(type(['r', 'e'], marked).composition.measures[2]?.repeatEnd).toBeUndefined();
        expect(type(['u', 'u'], marked).composition).toEqual(startSession(exampleComposition).composition);
    });
});
