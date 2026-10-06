/**
 * The modal input engine. Keys arrive in vim notation (`h`, `G`, `<Esc>`, `<C-w>`, `<Space>`)
 * and are interpreted against the current mode, building up `[count] command` in normal mode.
 * It knows nothing about rendering or audio: anything outside the score comes back as an effect.
 */

import { Composition, withTrailingEmptyMeasure } from '../composition/Composition';
import {
    deleteNote,
    deleteSelection,
    placeNote,
    placeRest,
    setLeafDuration,
    toggleArpeggios,
    toggleGlissandi,
    transposeNote,
    transposeSelection,
} from '../edit/Edit';
import { Duration } from '../duration/Duration';
import { ZERO, add, sub } from '../fraction/Fraction';
import { KeySignature } from '../key/KeySignature';
import { HairpinKind, resolveMeasures } from '../measure/Measure';
import {
    Cursor,
    backToMeasureStart,
    clampCursor,
    cursorAtOffset,
    cursorOffset,
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
import { Register, put, yankNote, yankSelection } from '../register/Register';
import { Selection, VisualKind, selectedChordPitches, selectedLeaves, visualSelection } from '../selection/Selection';
import { setKeySignature, setTempo, setTimeSignature } from '../edit/MeasureChanges';
import { addPart, deletePart, renamePart, setClef, setInstrument } from '../edit/Parts';
import { toggleRepeat } from '../edit/Repeats';
import { setVolume, toggleHairpin } from '../edit/Volume';
import { GENERAL_MIDI_INSTRUMENTS, Instrument } from '../instrument/Instrument';
import { Command, EditCommand, isEditCommand, parseCommand } from './CommandLine';
import { Picker, auditionPitch, filterPaths, listKey, pickerKey } from './Picker';
import { Mixer, mixerKey } from './MixerMode';
import { setMasterVolume, setPartVolume } from '../edit/Mixer';
import { midi } from '../pitch/Pitch';

/**
 * `normal` navigates; the insert modes enter notes, `insertMelody` moving on after each one; the
 * visual modes select from an anchor to the cursor; `command` is the `:` command line,
 * `picker` chooses an instrument, and `mixer` sets the parts' volumes
 */
export type EditMode = 'normal' | InsertKind | VisualKind | 'command' | 'picker' | 'mixer';

export type InsertKind = 'insert' | 'insertMelody';

export interface EditorState {
    mode: EditMode;
    cursor: Cursor;
    /** Where the visual selection started; set only in the visual modes */
    anchor?: Cursor;
    /** The note an insert mode will place; set only in the insert modes */
    phantom?: Phantom;
    /** What's typed after `:`, and why it couldn't run; set only in command mode */
    commandLine?: { text: string; error?: string };
    /** Set only in picker mode */
    picker?: Picker;
    /** Set only in mixer mode */
    mixer?: Mixer;
    /** What yanking or deleting last took, for putting back */
    register?: Register;
    /** Keys of a command still being typed, like a count or `<C-w>` */
    pending: string;
}

/** Something the editor wants done outside the score */
export type EditorEffect =
    | { kind: 'togglePlayback' }
    /** A `:` command, which needs files, dialogs or the window */
    | { kind: 'command'; command: Command }
    /** Play a note on an instrument, while choosing one */
    | { kind: 'audition'; instrument: Instrument; pitch: number }
    /** Switch between showing every staff at once and the normal size */
    | { kind: 'toggleZoom' }
    /** Sound these MIDI pitches briefly, so you hear what you just changed; `rolled` as an arpeggio */
    | { kind: 'preview'; pitches: number[]; part: number; rolled?: boolean };

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
        return { state, composition: moved, effect: pitches && { kind: 'preview', pitches, part: selection.firstPart } };
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
            effect: pitch === undefined ? undefined : { kind: 'preview', pitches: [midi(pitch)], part: moved.cursor.part },
        };
    };


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
        const pitches = event?.kind === 'chord' ? event.notes.map(({ pitch }) => midi(pitch)) : undefined;
        return { state, composition: edited, effect: pitches && { kind: 'preview', pitches, part: cursor.part } };
    };
}

/** `ga`: rolls the cursor's chord as an arpeggio or back, and plays it */
const toggleCursorArpeggio: Action = (state, composition) => {
    const { cursor } = state;
    const edited = toggleArpeggios(composition, [cursor]);
    if (!edited) return { state };
    const event = voiceLeaves(edited, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    if (event?.kind !== 'chord') return { state, composition: edited };
    const pitches = event.notes.map(({ pitch }) => midi(pitch));
    return { state, composition: edited, effect: { kind: 'preview', pitches, part: cursor.part, rolled: event.arpeggio } };
};

/** `ga` in visual mode: rolls every selected chord, or unrolls them if they all are already */
const toggleSelectedArpeggios: Action = (state, composition) => {
    const selection = editorSelection(composition, state);
    const edited = selection && toggleArpeggios(composition, selectedLeaves(composition, selection));
    return edited ? { state, composition: edited } : { state };
};

/** `gl`: slides the cursor's note on to the next chord, or stops it sliding */
const toggleCursorGlissando: Action = (state, composition) => {
    const edited = toggleGlissandi(composition, [state.cursor]);
    return edited ? { state, composition: edited } : { state };
};

/** `gl` in visual mode: slides every note of the selected chords on, or none if they all do already */
const toggleSelectedGlissandi: Action = (state, composition) => {
    const selection = editorSelection(composition, state);
    const edited = selection && toggleGlissandi(composition, selectedLeaves(composition, selection));
    return edited ? { state, composition: edited } : { state };
};

/**
 * Puts a hairpin over a selection, in each of its parts, or takes it off if it's already there.
 * Measures are covered from the start of the first to the end of the last.
 */
function hairpinOver(composition: Composition, selection: Selection, kind: HairpinKind): Composition {
    const resolved = resolveMeasures(composition.measures);
    const last = resolved.at(-1);
    const measureStart = (measure: number) =>
        resolved[measure]?.start ?? (last ? add(last.start, last.length) : ZERO);
    const [start, end] =
        selection.kind === 'measures'
            ? [{ measure: selection.first, offset: ZERO }, { measure: selection.last + 1, offset: ZERO }]
            : [selection.start, selection.end];
    const length = sub(add(measureStart(end.measure), end.offset), add(measureStart(start.measure), start.offset));
    let edited = composition;
    for (let part = selection.firstPart; part <= selection.lastPart; part++) {
        edited = toggleHairpin(edited, part, start.measure, start.offset, length, kind);
    }
    return edited;
}

/** `<` crescendos and `>` diminuendos over the cursor's chord or rest and count - 1 after it */
const hairpinFromCursor =
    (kind: HairpinKind): Action =>
    (state, composition, count = 1) => {
        const selection = block(composition, state.cursor, moveLeaf(composition, state.cursor, count - 1));
        return { state, composition: hairpinOver(composition, selection, kind) };
    };

/** `<` and `>` in visual mode put the hairpin over the selection, back in normal mode */
const hairpinOverSelected =
    (kind: HairpinKind): Action =>
    (state, composition) => {
        const selection = editorSelection(composition, state);
        if (!selection) return { state };
        return { state: { ...state, mode: 'normal', anchor: undefined }, composition: hairpinOver(composition, selection, kind) };
    };

const NORMAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    u: (state, _, count = 1) => ({ state, history: { direction: 'undo', count } }),
    z: (state) => ({ state, effect: { kind: 'toggleZoom' } }),
    // Repeat barlines at the cursor's measure, on or off
    rs: (state, composition) => ({ state, composition: toggleRepeat(composition, state.cursor.measure, 'start') }),
    re: (state, composition) => ({ state, composition: toggleRepeat(composition, state.cursor.measure, 'end') }),
    ga: toggleCursorArpeggio,
    gl: toggleCursorGlissando,
    '<': hairpinFromCursor('crescendo'),
    '>': hairpinFromCursor('diminuendo'),
    U: (state, _, count = 1) => ({ state, history: { direction: 'redo', count } }),
    // Just the note under the cursor. A lone `d` or `y` waits for a motion
    dd: (state, composition) => {
        const deleted = deleteNote(composition, state.cursor);
        if (!deleted) return { state };
        const register = yankNote(composition, state.cursor) ?? state.register;
        return { state: { ...state, cursor: deleted.cursor, register }, composition: deleted.composition };
    },
    yy: (state, composition) => ({ state: { ...state, register: yankNote(composition, state.cursor) ?? state.register } }),
    p: putRegister(true),
    P: putRegister(false),
    J: transposeCursorNote(-1),
    K: transposeCursorNote(1),
    i: enterInsert('insert'),
    a: enterInsert('insertMelody'),
    ':': (state) => ({ state: { ...state, mode: 'command', commandLine: { text: '' } } }),
};

/** Puts the register after the cursor's chord (`p`) or at it (`P`), count times over */
function putRegister(after: boolean): Action {
    return (state, composition, count = 1) => {
        const putting = state.register && put(composition, state.cursor, state.register, after, count);
        if (!putting) return { state };
        return { state: { ...state, cursor: putting.cursor }, composition: putting.composition };
    };
}

/** `d` deletes and `y` only yanks; both fill the register */
type Operator = 'd' | 'y';

/** Like vim, these leave visual mode with the cursor at the start of what they took */
const operateOnSelected =
    (operator: Operator): Action =>
    (state, composition) => {
        const selection = editorSelection(composition, state);
        return selection ? operate(operator, state, composition, selection) : { state };
    };

/** Yanks a selection, and deletes it for `d`, landing in normal mode at its start (top left of a block) */
function operate(operator: Operator, state: EditorState, composition: Composition, selection: Selection): KeyResult {
    const register = yankSelection(composition, selection) ?? state.register;
    const edited = operator === 'd' ? deleteSelection(composition, selection) : composition;
    const cursor =
        selection.kind === 'measures'
            ? cursorAtOffset(edited, selection.firstPart, selection.first, ZERO)
            : cursorAtOffset(edited, selection.firstPart, selection.start.measure, selection.start.offset);
    const done: EditorState = { ...state, mode: 'normal', anchor: undefined, cursor, register };
    return operator === 'd' ? { state: done, composition: edited } : { state: done };
}

/**
 * Like vim's `c`: deletes the selection (into the register) and starts inserting at its first
 * beat. Only within one staff, since insert mode writes into one. The phantom starts as the
 * note that was there, so the replacement starts from what it replaces.
 */
function changeSelected(state: EditorState, composition: Composition): KeyResult {
    const selection = editorSelection(composition, state);
    if (!selection || selection.firstPart !== selection.lastPart) return { state };

    const [measure, offset] =
        selection.kind === 'measures' ? [selection.first, ZERO] : [selection.start.measure, selection.start.offset];
    const replaced = cursorAtOffset(composition, selection.firstPart, measure, offset);
    const deleted = operate('d', state, composition, selection);
    return {
        ...deleted,
        state: { ...deleted.state, mode: 'insert', phantom: phantomAt(composition, replaced) },
    };
}

const VISUAL_ACTIONS: Record<string, Action> = {
    ...SHARED_ACTIONS,
    // Swap ends, to grow or shrink the selection from its other side
    o: (state) => ({ state: { ...state, cursor: state.anchor ?? state.cursor, anchor: state.cursor } }),
    d: operateOnSelected('d'),
    y: operateOnSelected('y'),
    c: changeSelected,
    J: transpose(-1),
    K: transpose(1),
    ga: toggleSelectedArpeggios,
    gl: toggleSelectedGlissandi,
    '<': hairpinOverSelected('crescendo'),
    '>': hairpinOverSelected('diminuendo'),
};

/** A count can't start with 0, so a lone `0` is left free for a future motion */
const COUNTED = /^([1-9][0-9]*)?(.*)$/;

/** What `d` or `y` followed by a motion covers. Undefined when there's nothing there */
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
const RANGES: Record<string, Range> = {
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
    RANGES[`<C-w>${direction}`] = RANGES[`<C-${direction}>`]!;
    RANGES[`<C-w><C-${direction}>`] = RANGES[`<C-${direction}>`]!;
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

/** `d` or `y`, its own count, then a motion; the motion part may still be on its way */
const OPERATOR = /^([dy])([1-9][0-9]*)?(.*)$/;

/** Counts before and after the operator multiply, like vim's `2d3l` deleting six */
function multiply(a: number | undefined, b: number | undefined): number | undefined {
    return a === undefined && b === undefined ? undefined : (a ?? 1) * (b ?? 1);
}

/** In visual mode, which selects whole measures, h and l step a measure at a time */
const MEASURE_MOTIONS: Record<string, Motion> = {
    h: (c, cursor, count = 1) => moveMeasure(c, cursor, -count),
    l: (c, cursor, count = 1) => moveMeasure(c, cursor, count),
};

/** Normal and visual modes share the `[count] command` grammar and the motions */
function commandKey(composition: Composition, state: EditorState, key: string, actions: Record<string, Action>): KeyResult {
    if (key === '<Esc>') return { state: { ...state, mode: 'normal', anchor: undefined, pending: '' } };

    const typed = state.pending + key;
    const [, digits, command = ''] = COUNTED.exec(typed)!;
    const count = digits === undefined ? undefined : Number(digits);
    const cleared = { ...state, pending: '' };

    const motion = (state.mode === 'visual' ? MEASURE_MOTIONS[command] : undefined) ?? MOTIONS[command];
    if (motion) return { state: { ...cleared, cursor: motion(composition, state.cursor, count) } };

    const action = actions[command];
    if (action) return action(cleared, composition, count);

    const operation = state.mode === 'normal' ? OPERATOR.exec(command) : null;
    if (operation) {
        const [, operatorKey, innerDigits, motionKeys = ''] = operation;
        const operator: Operator = operatorKey === 'y' ? 'y' : 'd';
        const range = RANGES[motionKeys];
        if (range) {
            const innerCount = innerDigits === undefined ? undefined : Number(innerDigits);
            const selection = range(composition, state.cursor, multiply(count, innerCount));
            return selection ? operate(operator, cleared, composition, selection) : { state: cleared };
        }
        const waiting = motionKeys === '' || Object.keys(RANGES).some((name) => name.startsWith(motionKeys));
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

    const { composition: edited, cursor } = moveOn(state, result.composition, result.cursor);
    return {
        state: { ...state, cursor },
        composition: edited,
        effect: {
            kind: 'preview',
            pitches: result.placed.notes.map(({ pitch }) => midi(pitch)),
            part: cursor.part,
            rolled: result.placed.arpeggio,
        },
    };
}

/** `<S-Space>`: a rest as long as the phantom, then on to the next beat in melody mode */
function placeRestKey(composition: Composition, state: EditorState, phantom: Phantom): KeyResult {
    const result = placeRest(composition, state.cursor, phantom.duration);
    if (!result) return { state };
    const { composition: edited, cursor } = moveOn(state, result.composition, result.cursor);
    return { state: { ...state, cursor }, composition: edited === composition ? undefined : edited };
}

/** After entering something: melody mode moves on to the next chord or rest */
function moveOn(state: EditorState, composition: Composition, cursor: Cursor) {
    if (state.mode !== 'insertMelody') return { composition, cursor };
    // The score grows as it fills, so the empty measure to move into has to exist first
    const grown = withTrailingEmptyMeasure(composition);
    return { composition: grown, cursor: moveLeaf(grown, cursor, 1) };
}

function insertKey(composition: Composition, state: EditorState, key: string): KeyResult {
    if (key === '<Esc>') return { state: { ...state, mode: 'normal', phantom: undefined, pending: '' } };

    const typed = state.pending + key;
    const [, digits, command = ''] = COUNTED.exec(typed)!;
    if (command === '') return { state: { ...state, pending: typed } };
    const count = digits === undefined ? 1 : Number(digits);
    const cleared = { ...state, pending: '' };

    if (command === '<Space>' && state.phantom) return place(composition, cleared, state.phantom);
    if (command === '<S-Space>' && state.phantom) return placeRestKey(composition, cleared, state.phantom);
    // Switches between staying on the note and moving on after each one, keeping the phantom
    // The session takes back the last note entered; see undoInsertSteps
    if (command === 'u') return { state: cleared, history: { direction: 'undo', count } };
    if (command === 'z') return { state: cleared, effect: { kind: 'toggleZoom' } };
    if (command === 'm') return { state: { ...cleared, mode: state.mode === 'insert' ? 'insertMelody' : 'insert' } };
    const adjust = PHANTOM_KEYS[command];
    const keySignature = resolveMeasures(composition.measures)[state.cursor.measure]?.keySignature;
    if (adjust && state.phantom && keySignature) {
        return { state: { ...cleared, phantom: adjust(state.phantom, keySignature, count) } };
    }
    return { state: cleared };
}

/**
 * Typing on the `:` command line: `<CR>` runs it, `<Esc>` (or backspacing past the start)
 * cancels. A command it can't read stays open with the error, to fix. `input.text` is the
 * character the key typed, which for shifted keys only the keyboard knows.
 */
function commandLineKey(composition: Composition, state: EditorState, key: string, input: KeyInput): KeyResult {
    const { commandLine } = state;
    const closed: EditorState = { ...state, mode: 'normal', commandLine: undefined };
    if (!commandLine || key === '<Esc>') return { state: closed };

    if (key === '<CR>') {
        if (commandLine.text.trim() === '') return { state: closed };
        const command = parseCommand(commandLine.text);
        if ('error' in command) return { state: { ...state, commandLine: { ...commandLine, error: command.error } } };
        if (isEditCommand(command)) return runEditCommand(composition, closed, command);
        return { state: closed, effect: { kind: 'command', command } };
    }

    if (key === '<BS>') {
        if (commandLine.text === '') return { state: closed };
        return { state: { ...state, commandLine: { text: commandLine.text.slice(0, -1) } } };
    }

    const typed = key === '<Space>' ? ' ' : (input.text ?? (key.length === 1 ? key : undefined));
    if (typed === undefined) return { state };
    return { state: { ...state, commandLine: { text: commandLine.text + typed } } };
}

/** Besides the key itself */
export interface KeyInput {
    /** The character the key typed, for the command line and picker; shifted keys differ by layout */
    text?: string;
    /** What the picker offers: the soundfont's instruments, or General MIDI's without one */
    instruments?: Instrument[];
    /** Scores opened before, newest first, for `:recent` */
    recentFiles?: string[];
}

/** Commands for parts, run straight away as edits */
function runEditCommand(composition: Composition, state: EditorState, command: EditCommand): KeyResult {
    const { part, measure } = state.cursor;
    switch (command.name) {
        case 'instrument':
        case 'addPart':
        case 'recent': {
            const picker: Picker = { purpose: command.name, query: command.query, selected: 0 };
            return { state: { ...state, mode: 'picker', picker } };
        }
        case 'deletePart': {
            // The cursor moves to the part that takes its place, or the one above at the bottom
            const edited = deletePart(composition, part);
            if (!edited) return { state };
            return { state: { ...state, cursor: clampCursor(edited, state.cursor) }, composition: edited };
        }
        case 'rename':
            return { state, composition: renamePart(composition, part, command.text) };
        case 'title':
            return { state, composition: { ...composition, title: command.text } };
        case 'clef':
            return { state, composition: setClef(composition, part, command.clef) };
        case 'keySignature':
            return { state, composition: setKeySignature(composition, measure, command.value) };
        case 'tempo': {
            // A bare number keeps the beat the tempo counts there, like dotted quarters in 6/8
            const beat = command.beat ?? resolveMeasures(composition.measures)[measure]?.tempo.beat;
            if (!beat) return { state };
            return { state, composition: setTempo(composition, measure, { bpm: command.bpm, beat }) };
        }
        case 'volume': {
            const offset = cursorOffset(composition, state.cursor);
            return { state, composition: setVolume(composition, part, measure, offset, command.percent) };
        }
        case 'partVolume':
            return { state, composition: setPartVolume(composition, part, command.percent) };
        case 'masterVolume':
            return { state, composition: setMasterVolume(composition, command.percent) };
        case 'mixer':
            return { state: { ...state, mode: 'mixer', mixer: { selected: part } } };
        case 'timeSignature': {
            // The measures may have been re-barred, so land on the first beat of the changed one
            const edited = setTimeSignature(composition, measure, command.value);
            return { state: { ...state, cursor: cursorAtOffset(edited, part, measure, ZERO) }, composition: edited };
        }
    }
}

function pickerModeKey(composition: Composition, state: EditorState, key: string, input: KeyInput): KeyResult {
    const instruments = input.instruments ?? GENERAL_MIDI_INSTRUMENTS;
    const closed: EditorState = { ...state, mode: 'normal', picker: undefined };
    if (!state.picker) return { state: closed };
    if (state.picker.purpose === 'recent') return recentPickerKey(state, closed, key, input);

    const outcome = pickerKey(state.picker, instruments, key, input.text);
    if ('cancelled' in outcome) return { state: closed };
    if ('picker' in outcome) {
        const { audition } = outcome;
        const effect: EditorEffect | undefined = audition && {
            kind: 'audition',
            instrument: audition,
            pitch: auditionPitch(audition),
        };
        return { state: { ...state, picker: outcome.picker }, effect };
    }

    const { chosen } = outcome;
    const { cursor } = state;
    if (state.picker.purpose === 'instrument') {
        return { state: closed, composition: setInstrument(composition, cursor.part, chosen, instruments) };
    }
    // The new part goes below the cursor's, and the cursor moves into it at the same time
    const edited = addPart(composition, cursor.part + 1, chosen);
    const moved = cursorAtOffset(edited, cursor.part + 1, cursor.measure, cursorOffset(composition, cursor));
    return { state: { ...closed, cursor: moved }, composition: edited };
}

/** Opening the chosen score is `:e` with its path, so changes still have to be saved first */
function recentPickerKey(state: EditorState, closed: EditorState, key: string, input: KeyInput): KeyResult {
    const items = filterPaths(input.recentFiles ?? [], state.picker!.query);
    const outcome = listKey(state.picker!, items, key, input.text);
    if ('cancelled' in outcome) return { state: closed };
    if ('picker' in outcome) return { state: { ...state, picker: outcome.picker } };
    return { state: closed, effect: { kind: 'command', command: { name: 'edit', path: outcome.chosen, force: false } } };
}

function mixerModeKey(composition: Composition, state: EditorState, key: string): KeyResult {
    const closed: EditorState = { ...state, mode: 'normal', mixer: undefined };
    if (!state.mixer) return { state: closed };
    const outcome = mixerKey(composition, state.mixer, key);
    if ('closed' in outcome) return { state: closed };
    return { state: { ...state, mixer: outcome.mixer }, composition: outcome.composition };
}

export function handleKey(composition: Composition, state: EditorState, key: string, input: KeyInput = {}): KeyResult {
    switch (state.mode) {
        case 'normal':
            return commandKey(composition, state, key, NORMAL_ACTIONS);
        case 'visual':
        case 'visualBlock':
            return commandKey(composition, state, key, VISUAL_ACTIONS);
        case 'insert':
        case 'insertMelody':
            return insertKey(composition, state, key);
        case 'command':
            return commandLineKey(composition, state, key, input);
        case 'picker':
            return pickerModeKey(composition, state, key, input);
        case 'mixer':
            return mixerModeKey(composition, state, key);
    }
}

/** What's selected in a visual mode, or undefined outside them */
export function editorSelection(composition: Composition, { mode, anchor, cursor }: EditorState): Selection | undefined {
    if ((mode === 'visual' || mode === 'visualBlock') && anchor) return visualSelection(composition, mode, anchor, cursor);
    return undefined;
}
