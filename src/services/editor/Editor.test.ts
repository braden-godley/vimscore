import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Cursor } from '../cursor/Cursor';
import { EditorState, KeyResult, editorSelection, handleKey, initialEditorState } from './Editor';
import { keyName } from './keys';

/** Feeds keys one at a time, returning the final result */
function type(keys: string[], state: EditorState = initialEditorState(exampleComposition)): KeyResult {
    let result: KeyResult = { state };
    for (const key of keys) result = handleKey(exampleComposition, result.state, key);
    return result;
}

/** Which chord or rest the cursor is on; Cursor.test covers which note of a chord it picks */
const at = (measure: number, leaf: number, part = 0) => ({ part, measure, voice: 0, leaf });
const where = ({ part, measure, voice, leaf }: Cursor) => ({ part, measure, voice, leaf });

describe('normal mode', () => {
    it('applies motions with and without counts', () => {
        expect(where(type(['l']).state.cursor)).toEqual(at(0, 1));
        expect(where(type(['3', 'l']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['1', '2', 'l']).state.cursor)).toEqual(at(1, 9));
        expect(where(type(['}', '}', '{']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['2', '}']).state.cursor)).toEqual(at(2, 0));
    });

    it('goes to measures by number', () => {
        expect(where(type(['G']).state.cursor)).toEqual(at(2, 0));
        expect(where(type(['2', 'G']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['G', 'g', 'g']).state.cursor)).toEqual(at(0, 0));
    });

    it('goes back to the start of the measure before the previous one', () => {
        // Mid-measure, the first { only goes back to this measure's first beat
        expect(where(type(['}', 'l', 'l', '{']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['}', 'l', 'l', '{', '{']).state.cursor)).toEqual(at(0, 0));
        expect(where(type(['G', 'l', '2', '{']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['G', '2', '{']).state.cursor)).toEqual(at(0, 0));
        expect(where(type(['{']).state.cursor)).toEqual(at(0, 0));
    });

    it('moves between parts with or without <C-w>', () => {
        for (const keys of [['<C-j>'], ['<C-w>', 'j'], ['<C-w>', '<C-j>']]) {
            expect(where(type(keys).state.cursor)).toEqual(at(0, 0, 1));
            expect(where(type([...keys, ...keys.map((key) => key.replace('j', 'k'))]).state.cursor)).toEqual(at(0, 0));
        }
    });

    it('waits for the rest of a multi-key command', () => {
        const partial = type(['2', '<C-w>']);
        expect(partial.state.pending).toBe('2<C-w>');
        expect(where(partial.state.cursor)).toEqual(at(0, 0));

        const done = type(['j'], partial.state);
        expect(done.state.pending).toBe('');
        expect(where(done.state.cursor)).toEqual(at(0, 0, 1));
    });

    it('discards unknown commands and cancels on escape', () => {
        expect(where(type(['3', 'z', 'l']).state.cursor)).toEqual(at(0, 1));
        expect(where(type(['3', '<Esc>', 'l']).state.cursor)).toEqual(at(0, 1));
        expect(type(['g', 'x']).state.pending).toBe('');
    });

    it('moves through a chord and on to the next stave with j and k', () => {
        // Starts on the top note of C-E-G
        expect(type(['j']).state.cursor.note).toBe(1);
        expect(type(['2', 'j']).state.cursor.note).toBe(0);
        expect(type(['j', 'k']).state.cursor.note).toBe(2);
        expect(where(type(['3', 'j']).state.cursor)).toEqual(at(0, 0, 1));
    });

    it('asks for playback to toggle', () => {
        expect(type(['<Space>']).effect).toEqual({ kind: 'togglePlayback' });
    });
});

describe('insert mode', () => {
    it('is entered with i and left with escape', () => {
        const inserting = type(['l', 'i']);
        expect(inserting.state.mode).toBe('insert');
        // Motions don't apply while inserting
        expect(where(type(['l'], inserting.state).state.cursor)).toEqual(at(0, 1));
        expect(type(['<Esc>'], inserting.state).state.mode).toBe('normal');
    });
});

describe('keyName', () => {
    const press = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
        keyName({ key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...mods });

    it('uses vim notation', () => {
        expect(press('h')).toBe('h');
        expect(press('G')).toBe('G');
        expect(press('Escape')).toBe('<Esc>');
        expect(press(' ')).toBe('<Space>');
        expect(press('w', { ctrlKey: true })).toBe('<C-w>');
        expect(press('[', { ctrlKey: true })).toBe('<Esc>');
        expect(press('D', { ctrlKey: true, shiftKey: true })).toBe('<C-D>');
        // Caps Lock reports a capital without Shift
        expect(press('D', { ctrlKey: true })).toBe('<C-d>');
    });

    it('ignores modifiers on their own and Cmd shortcuts', () => {
        expect(press('Shift')).toBeUndefined();
        expect(press('r', { metaKey: true })).toBeUndefined();
    });
});

describe('visual modes', () => {
    it('anchors where V was pressed and moves the cursor', () => {
        const { state } = type(['l', 'V', '}', 'l']);
        expect(state.mode).toBe('visual');
        expect(where(state.anchor!)).toEqual(at(0, 1));
        expect(where(state.cursor)).toEqual(at(1, 1));
        expect(editorSelection(exampleComposition, state)).toEqual({ kind: 'measures', first: 0, last: 1 });
    });

    it('swaps ends with o', () => {
        const { state } = type(['V', '}', 'o']);
        expect(where(state.cursor)).toEqual(at(0, 0));
        expect(where(state.anchor!)).toEqual(at(1, 0));
    });

    it('switches kind, keeping the anchor, and leaves with the same key or escape', () => {
        const block = type(['l', '<C-v>', 'l', 'V', '<C-v>']).state;
        expect(block.mode).toBe('visualBlock');
        expect(where(block.anchor!)).toEqual(at(0, 1));
        expect(editorSelection(exampleComposition, block)?.kind).toBe('block');

        for (const exit of ['<C-v>', '<Esc>']) {
            const { state } = type([exit], block);
            expect(state.mode).toBe('normal');
            expect(state.anchor).toBeUndefined();
            expect(editorSelection(exampleComposition, state)).toBeUndefined();
        }
    });

    it('does not enter insert mode', () => {
        expect(type(['V', 'i']).state.mode).toBe('visual');
    });
});

describe('transposing in visual modes', () => {
    it('moves the selection by half steps, counted, and stays in visual mode', () => {
        const down = type(['V', 'J']);
        expect(down.state.mode).toBe('visual');
        expect(down.composition?.parts[1]!.measures[0]!.voices[0]!.events[0]).toMatchObject({ notes: [{ pitch: 47 }] });

        const up = type(['<C-v>', '3', 'K']);
        expect(up.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: 63 }, { pitch: 67 }, { pitch: 70 }],
        });
        expect(up.composition?.parts[1]!.measures[0]).toBe(exampleComposition.parts[1]!.measures[0]);
    });

    it('does nothing in normal mode', () => {
        expect(type(['J']).composition).toBeUndefined();
    });
});

describe('previewing transposed notes', () => {
    it('plays a single chord, even across parts', () => {
        // Melody's first chord and the bass's whole note start together but last differently
        expect(type(['<C-v>', 'K']).effect).toEqual({ kind: 'preview', pitches: [61, 65, 68] });
        expect(type(['<C-v>', '<C-j>', 'K']).effect).toBeUndefined();
        expect(type(['G', '<C-v>', 'K']).effect).toEqual({ kind: 'preview', pitches: [73] });
    });

    it('stays quiet for notes at different times or of different lengths', () => {
        expect(type(['<C-v>', 'l', 'K']).effect).toBeUndefined();
        expect(type(['V', 'K']).effect).toBeUndefined();
    });

    it('stays quiet when nothing moved', () => {
        expect(type(['<C-v>', '9', '9', 'K']).effect).toBeUndefined();
    });
});
