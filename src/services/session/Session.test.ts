import { describe, expect, it } from 'vitest';
import { newComposition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { Session, sessionKey, startSession } from './Session';

function type(keys: string[], session: Session = startSession(exampleComposition)): Session {
    return keys.reduce((current, key) => sessionKey(current, key).session, session);
}

/** The melody's first chord, as pitches, or null for a rest */
const firstChord = ({ composition }: Session) => {
    const event = composition.parts[0]!.measures[0]!.voices[0]!.events[0]!;
    return event.kind === 'chord' ? event.notes.map(({ pitch }) => pitch) : null;
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

    it('is only for normal mode', () => {
        expect(type(['i', 'k', '<Space>', 'u']).editor.mode).toBe('insert');
        expect(type(['i', 'k', '<Space>', 'u']).composition).not.toEqual(start.composition);
    });
});

describe('changes for every part', () => {
    const typing = (text: string) => [...text];

    it('sets the time signature from the cursor measure with mt, re-barring', () => {
        const changed = type(['m', 't', ...typing('3/4'), '<CR>']);
        expect(changed.editor.mode).toBe('normal');
        expect(changed.composition.measures[0]?.timeSignature).toEqual({ beats: 3, beatValue: 4 });
        // C-E-G q, G-B-D q, C-E-G h re-barred into 3/4 spills a quarter into a new measure
        expect(changed.composition.parts[0]!.measures[1]!.voices[0]!.events[0]).toMatchObject({ kind: 'chord' });
        expect(changed.editor.cursor).toMatchObject({ measure: 0, leaf: 0 });
    });

    it('sets the key with mk and the tempo with mT, from the cursor measure', () => {
        const keyed = type(['}', 'm', 'k', ...typing('Eb'), '<CR>']);
        expect(keyed.composition.measures[1]?.keySignature).toEqual({ fifths: -3 });

        const faster = type(['}', 'm', 'T', ...typing('q=90'), '<CR>']);
        expect(faster.composition.measures[1]?.tempo).toEqual({ bpm: 90, beat: { base: 4, dots: 0 } });
    });

    it('takes the typed character for shifted keys', () => {
        const sharp = [['m'], ['k'], ['F'], ['<S-3>', '#'], ['<CR>']].reduce(
            (current, [key, text]) => sessionKey(current, key!, text).session,
            startSession(exampleComposition),
        );
        expect(sharp.composition.measures[0]?.keySignature).toEqual({ fifths: 6 });
    });

    it('keeps the prompt open with an error for something it cannot read', () => {
        const wrong = type(['m', 't', ...typing('3/5'), '<CR>']);
        expect(wrong.editor.mode).toBe('prompt');
        expect(wrong.editor.prompt?.error).toBe('Expected 3/4');
        // Typing clears the error, and backspace edits
        const fixed = type(['<BS>', '4'], wrong);
        expect(fixed.editor.prompt).toMatchObject({ text: '3/4', error: undefined });
    });

    it('cancels with escape, or backspacing past the start', () => {
        expect(type(['m', 't', '3', '<Esc>']).editor).toMatchObject({ mode: 'normal', prompt: undefined });
        expect(type(['m', 't', '<BS>']).editor.mode).toBe('normal');
        expect(type(['m', 't', '3', '<Esc>']).composition).toEqual(startSession(exampleComposition).composition);
    });

    it('can be undone', () => {
        const changed = type(['m', 't', ...typing('3/4'), '<CR>']);
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
            notes: [{ pitch: 71 }],
        });
    });
});
