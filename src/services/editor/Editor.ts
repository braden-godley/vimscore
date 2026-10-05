/**
 * The modal input engine. Keys arrive in vim notation (`h`, `G`, `<Esc>`, `<C-w>`, `<Space>`)
 * and are interpreted against the current mode, building up `[count] command` in normal mode.
 * It knows nothing about rendering or audio: anything outside the score comes back as an effect.
 */

import { Composition } from '../composition/Composition';
import { transposeSelection } from '../edit/Edit';
import { Cursor, backToMeasureStart, gotoMeasure, moveLeaf, moveMeasure, moveNote, movePart, startCursor } from '../cursor/Cursor';
import { Selection, VisualKind, selectedChordPitches, visualSelection } from '../selection/Selection';

/** `normal` navigates; `insert` will enter notes; the visual modes select from an anchor to the cursor */
export type EditMode = 'normal' | 'insert' | VisualKind;

export interface EditorState {
    mode: EditMode;
    cursor: Cursor;
    /** Where the visual selection started; set only in the visual modes */
    anchor?: Cursor;
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

const NORMAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    i: (state) => ({ state: { ...state, mode: 'insert' } }),
};

const VISUAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    // Swap ends, to grow or shrink the selection from its other side
    o: (state) => ({ state: { ...state, cursor: state.anchor ?? state.cursor, anchor: state.cursor } }),
    J: transpose(-1),
    K: transpose(1),
};

/** A count can't start with 0, so a lone `0` is left free for a future motion */
const COUNTED = /^([1-9][0-9]*)?(.*)$/;

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

    // Still typing a count or a multi-key command; anything else is discarded, like vim's beep
    const commands = [...Object.keys(MOTIONS), ...Object.keys(actions)];
    const incomplete = command === '' || commands.some((name) => name.startsWith(command));
    return { state: incomplete ? { ...state, pending: typed } : cleared };
}

function insertKey(state: EditorState, key: string): KeyResult {
    if (key === '<Esc>') return { state: { ...state, mode: 'normal' } };
    return { state };
}

export function handleKey(composition: Composition, state: EditorState, key: string): KeyResult {
    switch (state.mode) {
        case 'normal':
            return commandKey(composition, state, key, NORMAL_ACTIONS);
        case 'visual':
        case 'visualBlock':
            return commandKey(composition, state, key, VISUAL_ACTIONS);
        case 'insert':
            return insertKey(state, key);
    }
}

/** What's selected in a visual mode, or undefined outside them */
export function editorSelection(composition: Composition, { mode, anchor, cursor }: EditorState): Selection | undefined {
    if ((mode === 'visual' || mode === 'visualBlock') && anchor) return visualSelection(composition, mode, anchor, cursor);
    return undefined;
}
