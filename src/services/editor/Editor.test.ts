import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Cursor } from '../cursor/Cursor';
import { EditorState, KeyResult, editorSelection, handleKey, initialEditorState } from './Editor';
import { KeyPress, keyName } from './keys';

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

    it('starts the phantom as the selected note and shapes it', () => {
        // The top note of the first chord: a quarter G4
        expect(type(['i']).state.phantom).toEqual({ pitch: 67, duration: { base: 4, dots: 0 }, staccato: false });
        expect(type(['i', 'K', 'K', 'J', 'l', 'w', 's']).state.phantom).toEqual({
            pitch: 68,
            duration: { base: 2, dots: 1 },
            staccato: true,
        });
        expect(type(['i', 'h', 'h']).state.phantom?.duration).toEqual({ base: 16, dots: 0 });
    });

    it('places the phantom with <Space>, staying in insert mode', () => {
        // Raising the top G to A and placing adds A to the chord, and selects it
        const placed = type(['i', 'k', '<Space>']);
        expect(placed.state.mode).toBe('insert');
        expect(placed.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }, { pitch: 69 }],
        });
        expect(placed.state.cursor.note).toBe(3);
        // A place that doesn't fit changes nothing
        expect(type(['l', 'l', 'i', 'l', 'l', '<Space>']).composition).toBeUndefined();
    });

    it('steps the phantom through the scale with j and k, and by half steps with J and K', () => {
        // From G4 in C major
        expect(type(['i', 'k']).state.phantom?.pitch).toBe(69);
        expect(type(['i', 'j']).state.phantom?.pitch).toBe(65);
        expect(type(['i', 'K']).state.phantom?.pitch).toBe(68);
        expect(type(['i', 'J']).state.phantom?.pitch).toBe(66);
        // From off the scale, back onto it
        expect(type(['i', 'K', 'k']).state.phantom?.pitch).toBe(69);
    });

    it('drops the phantom on leaving', () => {
        expect(type(['i', '<Esc>']).state.phantom).toBeUndefined();
    });
});

describe('keyName', () => {
    const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}) =>
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

    it('names shifted digits by key, whatever the layout prints', () => {
        expect(press('!', { shiftKey: true, code: 'Digit1' })).toBe('<S-1>');
        expect(press('4', { code: 'Digit4' })).toBe('4');
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
        expect(editorSelection(exampleComposition, state)).toEqual({
            kind: 'measures',
            firstPart: 0,
            lastPart: 0,
            first: 0,
            last: 1,
        });
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
        const down = type(['V', '<C-j>', 'J']);
        expect(down.state.mode).toBe('visual');
        expect(down.composition?.parts[1]!.measures[0]!.voices[0]!.events[0]).toMatchObject({ notes: [{ pitch: 47 }] });

        const up = type(['<C-v>', '3', 'K']);
        expect(up.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: 63 }, { pitch: 67 }, { pitch: 70 }],
        });
        expect(up.composition?.parts[1]!.measures[0]).toBe(exampleComposition.parts[1]!.measures[0]);
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

describe('transposing in normal mode', () => {
    it('moves the cursor note by half steps, counted, and plays it', () => {
        const up = type(['K']);
        expect(up.state.mode).toBe('normal');
        expect(up.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: 68 }],
        });
        expect(up.effect).toEqual({ kind: 'preview', pitches: [68] });
        expect(type(['2', 'J']).effect).toEqual({ kind: 'preview', pitches: [65] });
    });

    it('does nothing onto a pitch the chord already has', () => {
        const blocked = type(['3', 'J']);
        expect(blocked.composition).toBeUndefined();
        expect(blocked.effect).toBeUndefined();
    });
});

describe('placing notes', () => {
    it('plays the chord the note joined', () => {
        expect(type(['i', 'k', '<Space>']).effect).toEqual({ kind: 'preview', pitches: [60, 64, 67, 69] });
    });

    it('stays put and plays nothing when removing', () => {
        // The phantom starts as the selected G, so placing it takes the G away
        const removed = type(['a', '<Space>']);
        expect(removed.effect).toBeUndefined();
        expect(where(removed.state.cursor)).toEqual(at(0, 0));
    });

    it('moves on to the next chord or rest in melody mode, keeping the phantom', () => {
        const placed = type(['a', 'k', '<Space>']);
        expect(placed.state.mode).toBe('insertMelody');
        expect(where(placed.state.cursor)).toEqual(at(0, 1));
        expect(placed.state.phantom?.pitch).toBe(69);
        // Plain insert mode stays on the note
        expect(where(type(['i', 'k', '<Space>']).state.cursor)).toEqual(at(0, 0));
    });

    it('moves into a new empty measure after the last one', () => {
        // The last melody event is an eighth rest
        const placed = type(['G', 'l', 'l', 'l', 'a', '<Space>']);
        expect(placed.composition?.measures).toHaveLength(4);
        expect(where(placed.state.cursor)).toEqual(at(3, 0));
    });
});

describe('deleting in visual modes', () => {
    it('deletes the selection and goes back to normal mode at its start', () => {
        const deleted = type(['}', 'V', '<C-j>', '{', 'd']);
        expect(deleted.state.mode).toBe('normal');
        expect(deleted.state.anchor).toBeUndefined();
        expect(where(deleted.state.cursor)).toEqual(at(0, 0));
        expect(deleted.composition?.parts[1]!.measures[1]!.voices[0]!.events).toEqual([
            { kind: 'rest', duration: { base: 2, dots: 1 } },
        ]);
    });

    it('lands on the top left of a block', () => {
        const deleted = type(['l', '<C-v>', 'l', '<C-j>', 'd']);
        expect(where(deleted.state.cursor)).toEqual(at(0, 0));
        expect(deleted.composition?.parts[1]!.measures[0]!.voices[0]!.events).toEqual([
            { kind: 'rest', duration: { base: 1, dots: 0 } },
        ]);
    });
});

describe('dd', () => {
    it('deletes the note under the cursor', () => {
        expect(type(['d']).state.pending).toBe('d');
        const deleted = type(['d', 'd']);
        expect(deleted.state.pending).toBe('');
        expect(deleted.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: 60 }, { pitch: 64 }],
        });
        // On to the nearest note left, the E
        expect(type(['d', 'd']).state.cursor.note).toBe(1);
    });

    it('does nothing on a rest', () => {
        expect(type(['G', 'l', 'l', 'l', 'd', 'd']).composition).toBeUndefined();
    });
});

describe('d with a motion', () => {
    /** The melody's (or another part's) events in a measure, as pitches per chord and null for rests */
    const pitches = (result: KeyResult, measure: number, part = 0) =>
        result.composition?.parts[part]!.measures[measure]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => pitch) : event.kind === 'rest' ? null : 'tuplet',
        );

    // Melody measure 1 (4/4): C-E-G quarter, G-B-D quarter, C-E-G half
    it('dl deletes the chord under the cursor, and counts take more', () => {
        expect(pitches(type(['d', 'l']), 0)).toEqual([null, [55, 59, 62], [60, 64, 67]]);
        expect(pitches(type(['2', 'd', 'l']), 0)).toEqual([null, [60, 64, 67]]);
        expect(pitches(type(['d', '2', 'l']), 0)).toEqual([null, [60, 64, 67]]);
        // 2d3l is six chords: all of measure 1 and the triplet, which becomes a plain rest
        expect(pitches(type(['2', 'd', '3', 'l']), 1)).toEqual([null, 'tuplet', 'tuplet']);
    });

    it('dh deletes the chords before the cursor and moves back', () => {
        const deleted = type(['l', 'l', 'd', 'h']);
        expect(pitches(deleted, 0)).toEqual([[60, 64, 67], null, [60, 64, 67]]);
        expect(where(deleted.state.cursor)).toEqual(at(0, 1));
        expect(type(['d', 'h']).composition).toBeUndefined();
    });

    it('d} deletes to the end of the measure, d{ back to its start', () => {
        expect(pitches(type(['l', 'd', '}']), 0)).toEqual([[60, 64, 67], null, null]);
        expect(pitches(type(['l', '2', 'd', '}']), 1)).toEqual([null]);

        const back = type(['l', 'l', 'd', '{']);
        expect(pitches(back, 0)).toEqual([null, [60, 64, 67]]);
        expect(where(back.state.cursor)).toEqual(at(0, 0));
        // From the first beat, d{ takes the whole measure before
        expect(pitches(type(['}', 'd', '{']), 0)).toEqual([null]);
        expect(type(['d', '{']).composition).toBeUndefined();
    });

    it('d<C-j> deletes this time in this part and the one below', () => {
        const deleted = type(['}', '}', 'l', 'd', '<C-j>']);
        // The bass's dotted half covers the whole 6/8 measure, so the block grows to all of it
        expect(pitches(deleted, 2, 1)).toEqual([null]);
        expect(pitches(deleted, 2)).toEqual([null]);
        expect(pitches(type(['d', '<C-w>', 'j']), 0, 1)).toEqual([null]);
    });

    it('dG and dgg delete whole measures of this part', () => {
        const toEnd = type(['}', 'd', 'G']);
        expect(pitches(toEnd, 1)).toEqual([null]);
        expect(pitches(toEnd, 2)).toEqual([null]);
        expect(pitches(toEnd, 0)).toEqual([[60, 64, 67], [55, 59, 62], [60, 64, 67]]);
        expect(pitches(toEnd, 2, 1)).toEqual([[48]]);
        expect(pitches(type(['<C-j>', '}', 'd', 'g', 'g']), 0, 1)).toEqual([null]);
    });

    it('waits for the motion and drops unknown ones', () => {
        for (const keys of [['d'], ['d', '2'], ['d', 'g'], ['d', '<C-w>']]) {
            expect(type(keys).state.pending).toBe(keys.join(''));
        }
        const unknown = type(['d', 'z']);
        expect(unknown.state.pending).toBe('');
        expect(unknown.composition).toBeUndefined();
    });

    it('is only an operator in normal mode', () => {
        expect(type(['V', 'd']).state.mode).toBe('normal');
    });
});

describe('number keys in insert mode', () => {
    it('set the value with Shift, counting from 4 for a quarter, and clear the dot and staccato', () => {
        const value = (keys: string[]) => type(['i', ...keys]).state.phantom?.duration;
        expect(value(['<S-5>'])).toEqual({ base: 2, dots: 0 });
        expect(value(['<S-6>'])).toEqual({ base: 1, dots: 0 });
        expect(value(['<S-3>'])).toEqual({ base: 8, dots: 0 });
        expect(value(['<S-1>'])).toEqual({ base: 32, dots: 0 });
        expect(type(['i', 'w', 's', '<S-4>']).state.phantom).toMatchObject({
            duration: { base: 4, dots: 0 },
            staccato: false,
        });
        // No double whole yet
        expect(value(['<S-7>'])).toEqual({ base: 4, dots: 0 });
    });

    it('are counts without Shift', () => {
        // From G4: three scale steps up is C5, two half steps down is F4
        expect(type(['i', '3', 'k']).state.phantom?.pitch).toBe(72);
        expect(type(['i', '2', 'J']).state.phantom?.pitch).toBe(65);
        expect(type(['i', '1', '2', 'K']).state.phantom?.pitch).toBe(79);
        expect(type(['i', '2', 'j']).state.phantom?.pitch).toBe(64);
        expect(type(['i', '2', 'l']).state.phantom?.duration.base).toBe(1);
    });

    it('wait in pending until the command, and escape drops them', () => {
        expect(type(['i', '1', '2']).state.pending).toBe('12');
        const escaped = type(['i', '3', '<Esc>']);
        expect(escaped.state.pending).toBe('');
        expect(escaped.state.mode).toBe('normal');
        // A count before something that doesn't take one is dropped
        expect(type(['i', '3', 'w', 'k']).state.phantom?.pitch).toBe(69);
    });
});

describe('number keys in normal mode', () => {
    it('change the selected chord with Shift, and play it', () => {
        const half = type(['<S-5>']);
        expect(half.composition?.parts[0]!.measures[0]!.voices[0]!.events).toEqual([
            { kind: 'chord', duration: { base: 2, dots: 0 }, notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }] },
            { kind: 'chord', duration: { base: 2, dots: 0 }, notes: [{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }] },
        ]);
        expect(half.effect).toEqual({ kind: 'preview', pitches: [60, 64, 67] });
        expect(half.state.cursor).toEqual(type([]).state.cursor);
    });

    it('do nothing without Shift, where they are counts', () => {
        expect(type(['5']).composition).toBeUndefined();
        expect(type(['5']).state.pending).toBe('5');
    });
});
