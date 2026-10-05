/**
 * The modal input engine. Keys arrive in vim notation (`h`, `G`, `<Esc>`, `<C-w>`, `<Space>`)
 * and are interpreted against the current mode, building up `[count] command` in normal mode.
 * It knows nothing about rendering or audio: anything outside the score comes back as an effect.
 */

import { Composition, withTrailingEmptyMeasure } from '../composition/Composition';
import { deleteNote, deleteSelection, placeNote, setLeafDuration, transposeNote, transposeSelection } from '../edit/Edit';
import { Duration } from '../duration/Duration';
import { ZERO } from '../fraction/Fraction';
import { KeySignature } from '../key/KeySignature';
import { resolveMeasures } from '../measure/Measure';
import {
    Cursor,
    backToMeasureStart,
    clampCursor,
    cursorAtOffset,
    cursorPitch,
    gotoMeasure,
    moveLeaf,
    moveMeasure,
    moveNote,
    movePart,
    startCursor,
    voiceLeaves,
} from '../cursor/Cursor';
import {
    Phantom,
    phantomAt,
    setDuration,
    shiftPitch,
    stepDuration,
    stepScale,
    toggleDot,
    toggleStaccato,
} from '../phantom/Phantom';
import { Selection, VisualKind, selectedChordPitches, visualSelection } from '../selection/Selection';
import { Prompt, PromptKind, applyPrompt } from './Prompt';

/**
 * `normal` navigates; the insert modes enter notes, `insertMelody` moving on after each one; the
 * visual modes select from an anchor to the cursor; `prompt` reads a value typed in
 */
export type EditMode = 'normal' | InsertKind | VisualKind | 'prompt';

export type InsertKind = 'insert' | 'insertMelody';

export interface EditorState {
    mode: EditMode;
    cursor: Cursor;
    /** Where the visual selection started; set only in the visual modes */
    anchor?: Cursor;
    /** The note an insert mode will place; set only in the insert modes */
    phantom?: Phantom;
    /** What's being typed for a change to every part; set only in prompt mode */
    prompt?: Prompt;
    /** Keys of a command still being typed, like a count or `<C-w>` */
    pending: string;
}

/** Something the editor wants done outside the score */
export type EditorEffect =
    | { kind: 'togglePlayback' }
    /** Sound these pitches briefly, so you hear what you just changed */
    | { kind: 'preview'; pitches: number[] };

export interface KeyResult {
    state: EditorState;
    effect?: EditorEffect;
    /** The edited composition, when the key changed it */
    composition?: Composition;
    /** Asks to go back or forward through the edit history, which the editor doesn't keep */
    history?: { direction: 'undo' | 'redo'; count: number };
}

export function initialEditorState(composition: Composition): EditorState {
    return { mode: 'normal', cursor: startCursor(composition), pending: '' };
}

/** A motion gets the count typed before it, or undefined if there wasn't one */
type Motion = (composition: Composition, cursor: Cursor, count: number | undefined) => Cursor;

const MOTIONS: Record<string, Motion> = {
    h: (c, cursor, count = 1) => moveLeaf(c, cursor, -count),
    l: (c, cursor, count = 1) => moveLeaf(c, cursor, count),
    j: (c, cursor, count = 1) => moveNote(c, cursor, -count),
    k: (c, cursor, count = 1) => moveNote(c, cursor, count),
    '{': (c, cursor, count = 1) => backToMeasureStart(c, cursor, count),
    '}': (c, cursor, count = 1) => moveMeasure(c, cursor, count),
    // Like vim's line numbers, a count picks a measure, counted from 1
    gg: (c, cursor, count = 1) => gotoMeasure(c, cursor, count - 1),
    G: (c, cursor, count = c.measures.length) => gotoMeasure(c, cursor, count - 1),
    '<C-j>': (c, cursor, count = 1) => movePart(c, cursor, count),
    '<C-k>': (c, cursor, count = 1) => movePart(c, cursor, -count),
};

// Vim's window motions, with or without Ctrl still held for the second key
for (const direction of ['j', 'k']) {
    MOTIONS[`<C-w>${direction}`] = MOTIONS[`<C-${direction}>`]!;
    MOTIONS[`<C-w><C-${direction}>`] = MOTIONS[`<C-${direction}>`]!;
}

/** Commands that don't move the cursor. Like motions, they get the count if one was typed */
type Action = (state: EditorState, composition: Composition, count: number | undefined) => KeyResult;

/** Like vim, the key for the visual mode you're in leaves it, and the other one switches to it */
const toggleVisual =
    (kind: VisualKind): Action =>
    (state) => ({
        state:
            state.mode === kind
                ? { ...state, mode: 'normal', anchor: undefined }
                : { ...state, mode: kind, anchor: state.anchor ?? state.cursor },
    });

/**
 * Moves the selected notes `semitones` per count, staying in visual mode to nudge again. When
 * the selection is a single chord, it's played so you can hear where it went.
 */
const transpose =
    (semitones: number): Action =>
    (state, composition, count = 1) => {
        const selection = editorSelection(composition, state);
        if (!selection) return { state };
        const moved = transposeSelection(composition, selection, semitones * count);
        if (moved === composition) return { state };

        const pitches = selectedChordPitches(moved, selection);
        return { state, composition: moved, effect: pitches && { kind: 'preview', pitches } };
    };

const SHARED_ACTIONS: Record<string, Action> = {
    '<Space>': (state) => ({ state, effect: { kind: 'togglePlayback' } }),
    V: toggleVisual('visual'),
    '<C-v>': toggleVisual('visualBlock'),
};

/** Moves the cursor's note `semitones` per count, and plays it */
const transposeCursorNote =
    (semitones: number): Action =>
    (state, composition, count = 1) => {
        const moved = transposeNote(composition, state.cursor, semitones * count);
        if (!moved) return { state };
        const pitch = cursorPitch(moved.composition, moved.cursor);
        return {
            state: { ...state, cursor: moved.cursor },
            composition: moved.composition,
            effect: pitch === undefined ? undefined : { kind: 'preview', pitches: [pitch] },
        };
    };

function openPrompt(kind: PromptKind): Action {
    return (state) => ({ state: { ...state, mode: 'prompt', prompt: { kind, measure: state.cursor.measure, text: '' } } });
}

/** The phantom starts as a copy of the selected note */
function enterInsert(mode: InsertKind): Action {
    return (state, composition) => ({ state: { ...state, mode, phantom: phantomAt(composition, state.cursor) } });
}

/** Gives the cursor's chord or rest a new value, and plays the chord */
function changeDuration(base: Duration['base']): Action {
    return (state, composition) => {
        const { cursor } = state;
        const edited = setLeafDuration(composition, cursor, { base, dots: 0 });
        if (!edited) return { state };
        const event = voiceLeaves(edited, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
        const pitches = event?.kind === 'chord' ? event.notes.map(({ pitch }) => pitch) : undefined;
        return { state, composition: edited, effect: pitches && { kind: 'preview', pitches } };
    };
}

const NORMAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    u: (state, _, count = 1) => ({ state, history: { direction: 'undo', count } }),
    U: (state, _, count = 1) => ({ state, history: { direction: 'redo', count } }),
    // Just the note under the cursor. A lone `d` waits, left free to become an operator
    dd: (state, composition) => {
        const deleted = deleteNote(composition, state.cursor);
        if (!deleted) return { state };
        return { state: { ...state, cursor: deleted.cursor }, composition: deleted.composition };
    },
    J: transposeCursorNote(-1),
    K: transposeCursorNote(1),
    i: enterInsert('insert'),
    a: enterInsert('insertMelody'),
    // Changes for every part, from the cursor's measure on
    mt: openPrompt('timeSignature'),
    mT: openPrompt('tempo'),
    mk: openPrompt('keySignature'),
};

/** Like vim, deleting leaves visual mode with the cursor at the start of what was deleted */
function deleteSelected(state: EditorState, composition: Composition): KeyResult {
    const selection = editorSelection(composition, state);
    return selection ? deleteRange(state, composition, selection) : { state };
}

/** Deletes a selection, landing in normal mode at its start (the top left of a block) */
function deleteRange(state: EditorState, composition: Composition, selection: Selection): KeyResult {
    const edited = deleteSelection(composition, selection);
    const cursor =
        selection.kind === 'measures'
            ? cursorAtOffset(edited, selection.firstPart, selection.first, ZERO)
            : cursorAtOffset(edited, selection.firstPart, selection.start.measure, selection.start.offset);
    return { state: { ...state, mode: 'normal', anchor: undefined, cursor }, composition: edited };
}

const VISUAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    // Swap ends, to grow or shrink the selection from its other side
    o: (state) => ({ state: { ...state, cursor: state.anchor ?? state.cursor, anchor: state.cursor } }),
    d: deleteSelected,
    J: transpose(-1),
    K: transpose(1),
};

/** A count can't start with 0, so a lone `0` is left free for a future motion */
const COUNTED = /^([1-9][0-9]*)?(.*)$/;

/** What `d` followed by a motion covers. Undefined when there's nothing there to delete */
type Range = (composition: Composition, cursor: Cursor, count: number | undefined) => Selection | undefined;

const block = (composition: Composition, from: Cursor, to: Cursor) =>
    visualSelection(composition, 'visualBlock', from, to);

const sameLeaf = (a: Cursor, b: Cursor) =>
    a.part === b.part && a.measure === b.measure && a.voice === b.voice && a.leaf === b.leaf;

/** Everything from `from` up to, but not including, the cursor's chord or rest */
const before = (composition: Composition, cursor: Cursor, from: Cursor) =>
    sameLeaf(from, cursor) ? undefined : block(composition, from, moveLeaf(composition, cursor, -1));

const lastLeafOf = (composition: Composition, cursor: Cursor, measure: number) =>
    clampCursor(composition, { ...cursor, measure, leaf: Number.MAX_SAFE_INTEGER });

/**
 * Like vim, most of these stop short of where the motion lands: `dl` takes the chord under the
 * cursor, `dh` the one before, `d}` runs to the end of the measure. The measure motions are
 * linewise, like V, taking whole measures of the cursor's part.
 */
const DELETE_RANGES: Record<string, Range> = {
    l: (c, cursor, count = 1) => block(c, cursor, moveLeaf(c, cursor, count - 1)),
    h: (c, cursor, count = 1) => before(c, cursor, moveLeaf(c, cursor, -count)),
    '}': (c, cursor, count = 1) => block(c, cursor, lastLeafOf(c, cursor, cursor.measure + count - 1)),
    '{': (c, cursor, count = 1) => before(c, cursor, backToMeasureStart(c, cursor, count)),
    // This chord's time in this part and the ones below or above
    '<C-j>': (c, cursor, count = 1) => block(c, cursor, movePart(c, cursor, count)),
    '<C-k>': (c, cursor, count = 1) => block(c, cursor, movePart(c, cursor, -count)),
    gg: (c, cursor, count = 1) => measuresBetween(cursor, count - 1),
    G: (c, cursor, count = c.measures.length) => measuresBetween(cursor, count - 1),
};

for (const direction of ['j', 'k']) {
    DELETE_RANGES[`<C-w>${direction}`] = DELETE_RANGES[`<C-${direction}>`]!;
    DELETE_RANGES[`<C-w><C-${direction}>`] = DELETE_RANGES[`<C-${direction}>`]!;
}

/** Whole measures of the cursor's part, from its measure to another */
function measuresBetween({ part, measure }: Cursor, other: number): Selection {
    return {
        kind: 'measures',
        firstPart: part,
        lastPart: part,
        first: Math.max(0, Math.min(measure, other)),
        last: Math.max(measure, other),
    };
}

/** `d`, its own count, then a motion; the motion part may still be on its way */
const OPERATOR = /^d([1-9][0-9]*)?(.*)$/;

/** Counts before and after the operator multiply, like vim's `2d3l` deleting six */
function multiply(a: number | undefined, b: number | undefined): number | undefined {
    return a === undefined && b === undefined ? undefined : (a ?? 1) * (b ?? 1);
}

/** Normal and visual modes share the `[count] command` grammar and the motions */
function commandKey(composition: Composition, state: EditorState, key: string, actions: Record<string, Action>): KeyResult {
    if (key === '<Esc>') return { state: { ...state, mode: 'normal', anchor: undefined, pending: '' } };

    const typed = state.pending + key;
    const [, digits, command = ''] = COUNTED.exec(typed)!;
    const count = digits === undefined ? undefined : Number(digits);
    const cleared = { ...state, pending: '' };

    const motion = MOTIONS[command];
    if (motion) return { state: { ...cleared, cursor: motion(composition, state.cursor, count) } };

    const action = actions[command];
    if (action) return action(cleared, composition, count);

    const operation = state.mode === 'normal' ? OPERATOR.exec(command) : null;
    if (operation) {
        const [, innerDigits, motionKeys = ''] = operation;
        const range = DELETE_RANGES[motionKeys];
        if (range) {
            const innerCount = innerDigits === undefined ? undefined : Number(innerDigits);
            const selection = range(composition, state.cursor, multiply(count, innerCount));
            return selection ? deleteRange(cleared, composition, selection) : { state: cleared };
        }
        const waiting = motionKeys === '' || Object.keys(DELETE_RANGES).some((name) => name.startsWith(motionKeys));
        return { state: waiting ? { ...state, pending: typed } : cleared };
    }

    // Still typing a count or a multi-key command; anything else is discarded, like vim's beep
    const commands = [...Object.keys(MOTIONS), ...Object.keys(actions)];
    const incomplete = command === '' || commands.some((name) => name.startsWith(command));
    return { state: incomplete ? { ...state, pending: typed } : cleared };
}

/** Insert mode's keys shape the phantom note, and <Space> places it; it doesn't take counts */
/** Shapes the phantom; moves take a count, like `3k` for three scale steps up */
type PhantomKey = (phantom: Phantom, key: KeySignature, count: number) => Phantom;

const PHANTOM_KEYS: Record<string, PhantomKey> = {
    // Plain j and k walk the scale; Shift steps chromatically
    j: (phantom, key, count) => stepScale(phantom, key, -count),
    k: (phantom, key, count) => stepScale(phantom, key, count),
    J: (phantom, _, count) => shiftPitch(phantom, -count),
    K: (phantom, _, count) => shiftPitch(phantom, count),
    h: (phantom, _, count) => stepDuration(phantom, -count),
    l: (phantom, _, count) => stepDuration(phantom, count),
    w: toggleDot,
    s: toggleStaccato,
};

// Shifted number keys pick a value outright, counting up from 4 for a quarter: 1 is a 32nd and
// 6 a whole. 7 would be a double whole, which durations can't hold yet. Plain digits are counts.
// In normal mode they change the selected chord or rest instead
const NUMBERED_VALUES: Duration['base'][] = [32, 16, 8, 4, 2, 1];
NUMBERED_VALUES.forEach((base, i) => {
    PHANTOM_KEYS[`<S-${i + 1}>`] = (phantom) => setDuration(phantom, base);
    NORMAL_ACTIONS[`<S-${i + 1}>`] = changeDuration(base);
});

/**
 * Places the phantom and plays the chord it joined. Melody mode then moves on to the next chord
 * or rest, ready for the next note; removing a note stays put either way.
 */
function place(composition: Composition, state: EditorState, phantom: Phantom): KeyResult {
    const result = placeNote(composition, state.cursor, phantom);
    if (!result) return { state };
    if (!result.placed) return { state: { ...state, cursor: result.cursor }, composition: result.composition };

    // The score grows as it fills, so the empty measure to move into has to exist first
    const edited = withTrailingEmptyMeasure(result.composition);
    const cursor = state.mode === 'insertMelody' ? moveLeaf(edited, result.cursor, 1) : result.cursor;
    return {
        state: { ...state, cursor },
        composition: edited,
        effect: { kind: 'preview', pitches: result.placed.notes.map(({ pitch }) => pitch) },
    };
}

function insertKey(composition: Composition, state: EditorState, key: string): KeyResult {
    if (key === '<Esc>') return { state: { ...state, mode: 'normal', phantom: undefined, pending: '' } };

    const typed = state.pending + key;
    const [, digits, command = ''] = COUNTED.exec(typed)!;
    if (command === '') return { state: { ...state, pending: typed } };
    const count = digits === undefined ? 1 : Number(digits);
    const cleared = { ...state, pending: '' };

    if (command === '<Space>' && state.phantom) return place(composition, cleared, state.phantom);
    const adjust = PHANTOM_KEYS[command];
    const keySignature = resolveMeasures(composition.measures)[state.cursor.measure]?.keySignature;
    if (adjust && state.phantom && keySignature) {
        return { state: { ...cleared, phantom: adjust(state.phantom, keySignature, count) } };
    }
    return { state: cleared };
}

/**
 * Typing into a prompt: `<CR>` applies it, `<Esc>` (or backspacing past the start) cancels.
 * `text` is the character the key typed, which for shifted keys only the keyboard knows.
 */
function promptKey(composition: Composition, state: EditorState, key: string, text: string | undefined): KeyResult {
    const { prompt } = state;
    const closed: EditorState = { ...state, mode: 'normal', prompt: undefined };
    if (!prompt || key === '<Esc>') return { state: closed };

    if (key === '<CR>') {
        const result = applyPrompt(composition, prompt);
        if ('error' in result) return { state: { ...state, prompt: { ...prompt, error: result.error } } };
        // The measures may have been re-barred, so land on the first beat of the changed one
        const cursor = cursorAtOffset(result, state.cursor.part, prompt.measure, ZERO);
        return { state: { ...closed, cursor }, composition: result };
    }

    if (key === '<BS>') {
        if (prompt.text === '') return { state: closed };
        return { state: { ...state, prompt: { ...prompt, text: prompt.text.slice(0, -1), error: undefined } } };
    }

    const typed = key === '<Space>' ? ' ' : (text ?? (key.length === 1 ? key : undefined));
    if (typed === undefined) return { state };
    return { state: { ...state, prompt: { ...prompt, text: prompt.text + typed, error: undefined } } };
}

export function handleKey(composition: Composition, state: EditorState, key: string, text?: string): KeyResult {
    switch (state.mode) {
        case 'normal':
            return commandKey(composition, state, key, NORMAL_ACTIONS);
        case 'visual':
        case 'visualBlock':
            return commandKey(composition, state, key, VISUAL_ACTIONS);
        case 'insert':
        case 'insertMelody':
            return insertKey(composition, state, key);
        case 'prompt':
            return promptKey(composition, state, key, text);
    }
}

/** What's selected in a visual mode, or undefined outside them */
export function editorSelection(composition: Composition, { mode, anchor, cursor }: EditorState): Selection | undefined {
    if ((mode === 'visual' || mode === 'visualBlock') && anchor) return visualSelection(composition, mode, anchor, cursor);
    return undefined;
}
