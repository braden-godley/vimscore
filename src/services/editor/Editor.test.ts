import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Cursor } from '../cursor/Cursor';
import { Chord } from '../event/Event';
import { EditorState, KeyResult, editorSelection, handleKey, initialEditorState } from './Editor';
import { parseCommand } from './CommandLine';
import { KeyPress, keyName } from './keys';
import { midi, pitch, spell } from '../pitch/Pitch';

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
        expect(type(['i']).state.phantom).toEqual({ pitch: spell(67), duration: { base: 4, dots: 0 }, staccato: false });
        // Up to A by sharps, then down a half step to a flat
        expect(type(['i', 'K', 'K', 'J', 'l', 'w', 's']).state.phantom).toEqual({
            pitch: pitch('Ab4'),
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
            notes: [{ pitch: spell(60) }, { pitch: spell(64) }, { pitch: spell(67) }, { pitch: spell(69) }],
        });
        expect(placed.state.cursor.note).toBe(3);
        // A place that doesn't fit changes nothing
        expect(type(['l', 'l', 'i', 'l', 'l', '<Space>']).composition).toBeUndefined();
    });

    it('steps the phantom through the scale with j and k, and by half steps with J and K', () => {
        // From G4 in C major
        expect(type(['i', 'k']).state.phantom?.pitch).toEqual(pitch('A4'));
        expect(type(['i', 'j']).state.phantom?.pitch).toEqual(pitch('F4'));
        // A half step spells a sharp going up and a flat going down
        expect(type(['i', 'K']).state.phantom?.pitch).toEqual(pitch('G#4'));
        expect(type(['i', 'J']).state.phantom?.pitch).toEqual(pitch('Gb4'));
        // From off the scale, back onto it
        expect(type(['i', 'K', 'k']).state.phantom?.pitch).toEqual(pitch('A4'));
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
        const { state } = type(['l', 'V', '}']);
        expect(state.mode).toBe('visual');
        expect(where(state.anchor!)).toEqual(at(0, 1));
        expect(where(state.cursor)).toEqual(at(1, 0));
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
        expect(down.composition?.parts[1]!.measures[0]!.voices[0]!.events[0]).toMatchObject({ notes: [{ pitch: spell(47) }] });

        const up = type(['<C-v>', '3', 'K']);
        expect(up.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).toMatchObject({
            notes: [{ pitch: spell(63) }, { pitch: spell(67) }, { pitch: spell(70) }],
        });
        expect(up.composition?.parts[1]!.measures[0]).toBe(exampleComposition.parts[1]!.measures[0]);
    });
});

describe('previewing transposed notes', () => {
    it('plays a single chord, even across parts', () => {
        // Melody's first chord and the bass's whole note start together but last differently
        expect(type(['<C-v>', 'K']).effect).toMatchObject({ kind: 'preview', pitches: [61, 65, 68] });
        expect(type(['<C-v>', '<C-j>', 'K']).effect).toBeUndefined();
        expect(type(['G', '<C-v>', 'K']).effect).toMatchObject({ kind: 'preview', pitches: [73] });
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
            notes: [{ pitch: spell(60) }, { pitch: spell(64) }, { pitch: spell(68) }],
        });
        expect(up.effect).toMatchObject({ kind: 'preview', pitches: [68] });
        expect(type(['2', 'J']).effect).toMatchObject({ kind: 'preview', pitches: [65] });
    });

    it('does nothing onto a pitch the chord already has', () => {
        const blocked = type(['3', 'J']);
        expect(blocked.composition).toBeUndefined();
        expect(blocked.effect).toBeUndefined();
    });
});

describe('ga', () => {
    const first = (result: KeyResult, leaf = 0) => result.composition?.parts[0]!.measures[0]!.voices[0]!.events[leaf];

    it("rolls the cursor's chord as an arpeggio, playing it rolled, and back", () => {
        const rolled = type(['g', 'a']);
        expect(first(rolled)).toMatchObject({ arpeggio: true });
        expect(rolled.effect).toMatchObject({ kind: 'preview', pitches: [60, 64, 67], rolled: true });

        const unrolled = handleKey(rolled.composition!, rolled.state, 'g');
        const back = handleKey(rolled.composition!, unrolled.state, 'a');
        expect(back.composition?.parts[0]!.measures[0]!.voices[0]!.events[0]).not.toHaveProperty('arpeggio');
        expect(back.effect).toMatchObject({ kind: 'preview', rolled: undefined });
    });

    it('does nothing on a rest', () => {
        expect(type(['G', 'l', 'l', 'l', 'g', 'a']).composition).toBeUndefined();
    });

    it('rolls every selected chord in visual mode, staying in it', () => {
        const rolled = type(['<C-v>', 'l', 'g', 'a']);
        expect(rolled.state.mode).toBe('visualBlock');
        expect([0, 1, 2].map((leaf) => first(rolled, leaf))).toMatchObject([{ arpeggio: true }, { arpeggio: true }, {}]);
        expect(first(rolled, 2)).not.toHaveProperty('arpeggio');
    });
});

describe('gl', () => {
    const first = (result: KeyResult, leaf = 0) => result.composition?.parts[0]!.measures[0]!.voices[0]!.events[leaf];

    it("slides the cursor's note on to the next chord, and back", () => {
        const sliding = type(['g', 'l']);
        // The cursor starts on the chord's top note
        expect((first(sliding) as Chord).notes.map((note) => !!note.glissando)).toEqual([false, false, true]);

        const pending = handleKey(sliding.composition!, sliding.state, 'g');
        const back = handleKey(sliding.composition!, pending.state, 'l');
        expect((first(back) as Chord).notes[2]).not.toHaveProperty('glissando');
    });

    it('does nothing on a rest', () => {
        expect(type(['G', 'l', 'l', 'l', 'g', 'l']).composition).toBeUndefined();
    });

    it('slides every note of the selected chords in visual mode', () => {
        const sliding = type(['<C-v>', 'l', 'g', 'l']);
        const glissandi = [0, 1].map((leaf) => (first(sliding, leaf) as Chord).notes.map((note) => !!note.glissando));
        expect(glissandi).toEqual([[true, true, true], [true, true, true]]);
    });
});

describe('gs', () => {
    const first = (result: KeyResult, leaf = 0) => result.composition?.parts[0]!.measures[0]!.voices[0]!.events[leaf];

    it("makes every note of the cursor's chord staccato, and back", () => {
        const short = type(['g', 's']);
        expect((first(short) as Chord).notes.map((note) => !!note.staccato)).toEqual([true, true, true]);

        const pending = handleKey(short.composition!, short.state, 'g');
        const back = handleKey(short.composition!, pending.state, 's');
        expect((first(back) as Chord).notes.some((note) => 'staccato' in note)).toBe(false);
    });

    it('does nothing on a rest', () => {
        expect(type(['G', 'l', 'l', 'l', 'g', 's']).composition).toBeUndefined();
    });

    it('makes every selected chord staccato in visual mode', () => {
        const short = type(['<C-v>', 'l', 'g', 's']);
        const staccatos = [0, 1].map((leaf) => (first(short, leaf) as Chord).notes.map((note) => !!note.staccato));
        expect(staccatos).toEqual([[true, true, true], [true, true, true]]);
    });
});

describe('gw', () => {
    const value = (result: KeyResult) => (result.composition?.parts[0]!.measures[0]!.voices[0]!.events[0] as Chord | undefined)?.duration;

    it("dots the cursor's chord, writing over what follows, plays it, and takes the dot off again", () => {
        const dotted = type(['g', 'w']);
        expect(value(dotted)).toEqual({ base: 4, dots: 1 });
        expect(dotted.effect).toMatchObject({ kind: 'preview', pitches: [60, 64, 67] });

        const pending = handleKey(dotted.composition!, dotted.state, 'g');
        expect(value(handleKey(dotted.composition!, pending.state, 'w'))).toEqual({ base: 4, dots: 0 });
    });

    it('dots a rest too', () => {
        // Halving the first chord leaves an eighth rest after it
        const halved = type(['<S-3>']);
        const keys = ['l', 'g', 'w'].reduce((result, key) => handleKey(halved.composition!, result.state, key), halved);
        expect(keys.composition?.parts[0]!.measures[0]!.voices[0]!.events[1]).toEqual({ kind: 'rest', duration: { base: 8, dots: 1 } });
    });

    it("refuses a dot that doesn't fit in the measure", () => {
        expect(type(['l', 'l', 'g', 'w']).composition).toBeUndefined();
    });
});

describe('gt', () => {
    const notes = (result: KeyResult, leaf = 0) =>
        (result.composition?.parts[0]!.measures[0]!.voices[0]!.events[leaf] as Chord | undefined)?.notes;

    it("ties just the cursor's note, and unties it", () => {
        // The cursor starts on the chord's top note, the G
        const tied = type(['g', 't']);
        expect(notes(tied)?.map((note) => !!note.tie)).toEqual([false, false, true]);

        const pending = handleKey(tied.composition!, tied.state, 'g');
        expect(notes(handleKey(tied.composition!, pending.state, 't'))?.some((note) => 'tie' in note)).toBe(false);
    });

    it('does nothing on a rest', () => {
        expect(type(['G', 'l', 'l', 'l', 'g', 't']).composition).toBeUndefined();
    });

    it('ties every selected chord in visual mode', () => {
        const tied = type(['<C-v>', 'l', 'g', 't']);
        expect([0, 1].map((leaf) => notes(tied, leaf)?.every((note) => note.tie))).toEqual([true, true]);
    });
});

describe('placing notes', () => {
    it('plays the chord the note joined', () => {
        expect(type(['i', 'k', '<Space>']).effect).toMatchObject({ kind: 'preview', pitches: [60, 64, 67, 69] });
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
        expect(placed.state.phantom?.pitch).toEqual(pitch('A4'));
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
            notes: [{ pitch: spell(60) }, { pitch: spell(64) }],
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
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : event.kind === 'rest' ? null : 'tuplet',
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
        expect(type(['i', '3', 'k']).state.phantom?.pitch).toEqual(pitch('C5'));
        expect(type(['i', '2', 'J']).state.phantom?.pitch).toEqual(pitch('F4'));
        expect(type(['i', '1', '2', 'K']).state.phantom?.pitch).toEqual(pitch('G5'));
        expect(type(['i', '2', 'j']).state.phantom?.pitch).toEqual(pitch('E4'));
        expect(type(['i', '2', 'l']).state.phantom?.duration.base).toBe(1);
    });

    it('wait in pending until the command, and escape drops them', () => {
        expect(type(['i', '1', '2']).state.pending).toBe('12');
        const escaped = type(['i', '3', '<Esc>']);
        expect(escaped.state.pending).toBe('');
        expect(escaped.state.mode).toBe('normal');
        // A count before something that doesn't take one is dropped
        expect(type(['i', '3', 'w', 'k']).state.phantom?.pitch).toEqual(pitch('A4'));
    });
});

describe('number keys in normal mode', () => {
    it('change the selected chord with Shift, and play it', () => {
        const half = type(['<S-5>']);
        expect(half.composition?.parts[0]!.measures[0]!.voices[0]!.events).toEqual([
            { kind: 'chord', duration: { base: 2, dots: 0 }, notes: [{ pitch: spell(60) }, { pitch: spell(64) }, { pitch: spell(67) }] },
            { kind: 'chord', duration: { base: 2, dots: 0 }, notes: [{ pitch: spell(60) }, { pitch: spell(64) }, { pitch: spell(67) }] },
        ]);
        expect(half.effect).toMatchObject({ kind: 'preview', pitches: [60, 64, 67] });
        expect(half.state.cursor).toEqual(type([]).state.cursor);
    });

    it('do nothing without Shift, where they are counts', () => {
        expect(type(['5']).composition).toBeUndefined();
        expect(type(['5']).state.pending).toBe('5');
    });
});

describe('yanking and putting', () => {
    const melody = (result: KeyResult, measure: number) =>
        result.composition?.parts[0]!.measures[measure]!.voices[0]!.events.map((event) =>
            event.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : event.kind,
        );

    it('yy yanks the note, and p puts it into another chord', () => {
        const put = type(['y', 'y', 'l', 'p']);
        expect(put.state.register).toMatchObject({ kind: 'note', note: { pitch: spell(67) } });
        expect(melody(put, 0)).toEqual([[60, 64, 67], [55, 59, 62, 67], [60, 64, 67]]);
    });

    it('y with a motion yanks without changing anything, landing at the start', () => {
        const yanked = type(['l', 'l', 'y', 'h']);
        expect(yanked.composition).toBeUndefined();
        expect(where(yanked.state.cursor)).toEqual(at(0, 1));
        expect(yanked.state.register).toMatchObject({ kind: 'clip', measures: false });
    });

    it('puts clips at the cursor with P and after its chord with p, counted', () => {
        // The G-B-D chord, over the first chord, then three times from the start
        expect(melody(type(['l', 'y', 'l', 'h', 'P']), 0)).toEqual([[55, 59, 62], [55, 59, 62], [60, 64, 67]]);
        expect(melody(type(['l', 'y', 'l', 'h', '3', 'P']), 0)).toEqual([
            [55, 59, 62],
            [55, 59, 62],
            [55, 59, 62],
            'rest',
        ]);
        expect(melody(type(['l', 'y', 'l', 'p']), 0)).toEqual([[60, 64, 67], [55, 59, 62], [55, 59, 62], 'rest']);
    });

    it('d with a motion and visual d fill the register, ready to put back', () => {
        expect(melody(type(['d', 'l', 'P']), 0)).toEqual([[60, 64, 67], [55, 59, 62], [60, 64, 67]]);
        expect(melody(type(['V', 'd', 'P']), 0)).toEqual([[60, 64, 67], [55, 59, 62], [60, 64, 67]]);
    });

    it('visual y yanks and goes back to normal mode at the start', () => {
        const yanked = type(['}', 'V', '{', 'y']);
        expect(yanked.state.mode).toBe('normal');
        expect(yanked.composition).toBeUndefined();
        expect(where(yanked.state.cursor)).toEqual(at(0, 0));
        expect(yanked.state.register).toMatchObject({ kind: 'clip', measures: true });
    });

    it('does nothing with an empty register', () => {
        expect(type(['p']).composition).toBeUndefined();
    });
});

describe('parseCommand for parts', () => {
    it('reads instrument, part and soundfont commands', () => {
        expect(parseCommand('addpart')).toEqual({ name: 'addPart', query: '' });
        expect(parseCommand('inst  string ens')).toEqual({ name: 'instrument', query: 'string ens' });
        expect(parseCommand('delpart')).toEqual({ name: 'deletePart' });
        expect(parseCommand('rename Violin I')).toEqual({ name: 'rename', text: 'Violin I' });
        expect(parseCommand('clef alto')).toEqual({ error: 'Expected :clef treble or bass' });
        expect(parseCommand('rename')).toEqual({ error: 'Rename to what? :rename Violin I' });
        expect(parseCommand('title Aqua Game')).toEqual({ name: 'title', text: 'Aqua Game' });
        expect(parseCommand('title')).toEqual({ error: 'Title it what? :title Aqua Game' });
        expect(parseCommand('soundfont')).toEqual({ name: 'soundfont', path: undefined });
        expect(parseCommand('addsf ~/sf/Strings.sf2')).toEqual({ name: 'addSoundfont', path: '~/sf/Strings.sf2' });
        expect(parseCommand('delsf 2')).toEqual({ name: 'deleteSoundfont', which: '2' });
        expect(parseCommand('delsf')).toEqual({ error: 'Remove which? :delsf 2, or :delsf and its name' });
        expect(parseCommand('soundfonts')).toEqual({ name: 'listSoundfonts' });
        expect(parseCommand('sfs x')).toEqual({ error: ':sfs takes nothing after it' });
    });
});

describe('keyName for Shift-Space', () => {
    it('is <S-Space>', () => {
        expect(keyName({ key: ' ', ctrlKey: false, shiftKey: true, metaKey: false, altKey: false })).toBe('<S-Space>');
    });
});

describe('parseCommand for export', () => {
    it('reads a format and an optional file', () => {
        expect(parseCommand('export mp3')).toEqual({ name: 'export', format: 'mp3', path: undefined, force: false });
        expect(parseCommand('export! mp3 ~/out/a b.mp3')).toEqual({
            name: 'export',
            format: 'mp3',
            path: '~/out/a b.mp3',
            force: true,
        });
        expect(parseCommand('export mp4')).toEqual({ name: 'export', format: 'mp4', path: undefined, force: false });
        expect(parseCommand('export musanim')).toEqual({ name: 'export', format: 'musanim', path: undefined, force: false });
        expect(parseCommand('export midi')).toEqual({ name: 'export', format: 'midi', path: undefined, force: false });
        expect(parseCommand('export mid')).toEqual({ name: 'export', format: 'midi', path: undefined, force: false });
        expect(parseCommand('export wav')).toEqual({ error: 'Expected :export mp3, mp4, musanim or midi [file]' });
        expect(parseCommand('export')).toEqual({ error: 'Expected :export mp3, mp4, musanim or midi [file]' });
    });
});

describe('z', () => {
    it('asks to toggle zooming out, in normal and insert mode', () => {
        expect(type(['z']).effect).toEqual({ kind: 'toggleZoom' });
        const inserting = type(['i', 'z']);
        expect(inserting.effect).toEqual({ kind: 'toggleZoom' });
        expect(inserting.state.mode).toBe('insert');
        // Not as a pitch or anything else
        expect(inserting.state.phantom).toEqual(type(['i']).state.phantom);
    });
});

describe('h and l in visual mode', () => {
    it('move by whole measures, with counts', () => {
        expect(where(type(['V', 'l']).state.cursor)).toEqual(at(1, 0));
        expect(where(type(['V', '2', 'l']).state.cursor)).toEqual(at(2, 0));
        expect(where(type(['G', 'V', 'h']).state.cursor)).toEqual(at(1, 0));
        expect(editorSelection(exampleComposition, type(['V', 'l']).state)).toMatchObject({ first: 0, last: 1 });
    });

    it('still move by chords in visual block mode and normal mode', () => {
        expect(where(type(['<C-v>', 'l']).state.cursor)).toEqual(at(0, 1));
        expect(where(type(['l']).state.cursor)).toEqual(at(0, 1));
    });
});

describe(':recent', () => {
    const recentFiles = ['/scores/Aqua Game.vimscore', '/scores/waltz.vimscore', '/old/Aqua Theme.vimscore'];
    const typeWith = (keys: string[]) => {
        let result: KeyResult = { state: initialEditorState(exampleComposition) };
        for (const key of keys) result = handleKey(exampleComposition, result.state, key, { recentFiles });
        return result;
    };
    const command = (text: string) => [':', ...text.split(''), '<CR>'];

    it('opens a picker over the recent scores', () => {
        expect(typeWith(command('recent')).state).toMatchObject({ mode: 'picker', picker: { purpose: 'recent', query: '' } });
        expect(parseCommand('recent aqua')).toEqual({ name: 'recent', query: 'aqua' });
    });

    it('filters as you type, moves with Ctrl-N/P, and opens the choice with :e', () => {
        const { effect, state } = typeWith([...command('recent'), 'a', 'q', 'u', 'a', '<C-n>', '<CR>']);
        expect(state.mode).toBe('normal');
        expect(effect).toEqual({ kind: 'command', command: { name: 'edit', path: '/old/Aqua Theme.vimscore', force: false } });
        expect(typeWith([...command('recent'), '<C-p>', '<CR>']).effect).toMatchObject({
            command: { path: '/old/Aqua Theme.vimscore' },
        });
    });

    it('closes with Esc, opening nothing', () => {
        const result = typeWith([...command('recent'), '<Esc>']);
        expect(result.state.mode).toBe('normal');
        expect(result.effect).toBeUndefined();
    });
});

describe(':help', () => {
    it('opens the manual, at a topic if given, and closes with q', () => {
        const command = (text: string) => [':', ...text.split(''), '<CR>'];
        expect(type(command('help')).state).toMatchObject({ mode: 'help', help: { top: 0 } });
        expect(type(command('h tempo')).state.help?.query).toBe('tempo');
        expect(type([...command('help'), 'q']).state).toMatchObject({ mode: 'normal', help: undefined });
    });
});
