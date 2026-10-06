import { cursorSeconds } from '../../services/cursor/Cursor';
import { EditMode, EditorState, editorSelection } from '../../services/editor/Editor';
import { keyName } from '../../services/editor/keys';
import { Command, isFileCommand } from '../../services/editor/CommandLine';
import { Picker, pickerItems } from '../../services/editor/Picker';
import { setSoundfont } from '../../services/edit/Parts';
import { Document, isModified, newDocument, runCommand } from '../../services/file/Commands';
import { newComposition } from '../../services/composition/Composition';
import { GENERAL_MIDI_INSTRUMENTS, Instrument } from '../../services/instrument/Instrument';
import { resolveMeasures, secondsPerWholeNote } from '../../services/measure/Measure';
import { PlayedMeasure, performance, playedMeasureAt } from '../../services/timeline/performance';
import { Player } from '../../services/player/Player';
import { sessionEdit, sessionKey } from '../../services/session/Session';
import { ToneSynth } from '../../services/synth/ToneSynth';
import { writeMidi } from '../../services/export/midi';
import { Renderer, runExport } from '../../services/export/runExport';
import { SoundfontSynth } from './audio/SoundfontSynth';
import { exportMp3, renderPcm } from './audio/exportAudio';
import { exportMusanim } from './video/exportMusanim';
import { exportVideo } from './video/exportVideo';
import { SwitchableSynth } from './audio/SwitchableSynth';
import { ScoreView } from './score/ScoreView';
import { describePhantom } from './score/notation';

/**
 * The score being edited and the file it's saved in; its session holds the composition. The
 * app is either playing, following the playhead, or editing, following the cursor.
 */
let current: Document = newDocument();
let measures = resolveMeasures(current.session.composition.measures);
/** The measures in the order they play, repeats and all, for following playback */
let played: PlayedMeasure[] = performance(current.session.composition);

const audio = new AudioContext();
const tone = new ToneSynth(audio);
const synth = new SwitchableSynth(tone);
const player = new Player(audio, synth);
player.setComposition(current.session.composition);

/** The soundfont playing, and its instruments; General MIDI's names until one loads */
let soundfont: { path: string; synth: SoundfontSynth } | undefined;
let instruments: Instrument[] = GENERAL_MIDI_INSTRUMENTS;
let soundfontSynth: Promise<SoundfontSynth> | undefined;

const view = new ScoreView(document.querySelector<HTMLElement>('#viewport')!);
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
const commandLineLabel = document.querySelector<HTMLElement>('#command-line')!;
const messageLabel = document.querySelector<HTMLElement>('#message')!;
const keysLabel = document.querySelector<HTMLElement>('#keys')!;
const positionLabel = document.querySelector<HTMLElement>('#position')!;
const pickerPanel = document.querySelector<HTMLElement>('#picker')!;

const MODE_LABELS: Record<EditMode, string> = {
    normal: '',
    insert: '-- INSERT --',
    insertMelody: '-- INSERT MELODY --',
    visual: '-- VISUAL --',
    visualBlock: '-- VISUAL BLOCK --',
    command: '',
    picker: '',
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string | undefined) => path?.replace(/[\\/][^\\/]*$/, '');

/**
 * Plays through a soundfont from now on. The worklet starts the first time. Returns an error
 * to show if the file can't be read or isn't a soundfont, and keeps the old sound then.
 */
async function loadSoundfont(path: string): Promise<string | undefined> {
    if (soundfont?.path === path) return undefined;
    try {
        soundfontSynth ??= SoundfontSynth.create(audio);
        const loaded = await soundfontSynth;
        instruments = await loaded.load(await window.files.readBinary(path));
        soundfont = { path, synth: loaded };
        synth.use(loaded);
        return undefined;
    } catch (error) {
        return `Can't load soundfont "${fileName(path)}": ${(error as Error).message}`;
    }
}

/** A new score, with the soundfont last loaded */
function blankScore() {
    return soundfont ? setSoundfont(newComposition(), soundfont.path) : newComposition();
}

/** Loads the soundfont a score names, if it isn't playing already */
async function loadScoreSoundfont() {
    const path = current.session.composition.soundfont.filePath;
    if (!path) return;
    const error = await loadSoundfont(path);
    if (error) showMessage(error, true);
}

/** `:soundfont [path]`: loads it, sets it in the score (undoably), and makes it the default */
async function runSoundfontCommand(typed: string | undefined) {
    const chosen = typed
        ? await window.files.resolve(typed, folder(current.path))
        : await window.files.chooseSoundfontPath();
    if (!chosen) return;
    const error = await loadSoundfont(chosen);
    if (error) {
        showMessage(error, true);
        return;
    }
    const { session } = current;
    current = { ...current, session: sessionEdit(session, setSoundfont(session.composition, chosen)) };
    await window.settings.set({ ...(await window.settings.get()), soundfont: chosen });
    showMessage(`"${fileName(chosen)}" ${instruments.length} instruments`);
    showEditing();
}

/** The instrument list over the score while choosing, like a fuzzy finder */
function showPicker(picker: Picker | undefined) {
    pickerPanel.hidden = !picker;
    if (!picker) return;
    const items = pickerItems(picker, instruments);
    const partName = current.session.composition.parts[current.session.editor.cursor.part]?.name ?? '';
    const heading = picker.purpose === 'addPart' ? 'New part' : `Instrument for ${partName}`;

    // A window of the list around the selection
    const shown = 12;
    const first = Math.max(0, Math.min(picker.selected - Math.floor(shown / 2), items.length - shown));
    const rows = items.slice(first, first + shown).map((instrument, i) => {
        const row = document.createElement('li');
        row.className = first + i === picker.selected ? 'selected' : '';
        const { bank, program, drums } = instrument;
        const detail = drums ? 'drums' : `${bank ? `${bank}:` : ''}${program + 1}`;
        row.append(instrument.name, Object.assign(document.createElement('span'), { textContent: detail }));
        return row;
    });
    const list = document.createElement('ul');
    list.append(...rows);
    if (items.length === 0) {
        list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No match' }));
    }
    const source = soundfont ? `in ${fileName(soundfont.path)}` : '(General MIDI, no soundfont loaded)';

    pickerPanel.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'picker-heading', textContent: heading }),
        Object.assign(document.createElement('div'), { className: 'picker-query', textContent: picker.query }),
        list,
        Object.assign(document.createElement('div'), {
            className: 'picker-count',
            textContent: `${items.length} of ${instruments.length} ${source}`,
        }),
    );
}

/** The `:` command line takes over the status bar, like vim's */
function showCommandLine(commandLine: EditorState['commandLine']) {
    commandLineLabel.hidden = !commandLine;
    if (!commandLine) return;
    commandLineLabel.replaceChildren(
        ':',
        Object.assign(document.createElement('span'), { className: 'command-text', textContent: commandLine.text }),
        Object.assign(document.createElement('span'), { className: 'command-error', textContent: commandLine.error ?? '' }),
    );
}

/** A line for the status bar, like vim's after `:w`; the next key clears it */
function showMessage(text: string, error = false) {
    messageLabel.textContent = text;
    messageLabel.classList.toggle('error', error);
}

/** The file's name in the title bar, marked while it has changes */
function showTitle() {
    // An imported score goes by the name it'll be saved under
    const name = (current.path ?? current.suggestedPath)?.split(/[\\/]/).pop() ?? 'Untitled';
    document.title = `${name}${isModified(current) ? ' •' : ''} — vimscore`;
}

/** Draws the composition again after it changes: an edit, an undo, or opening a file */
function showComposition() {
    const { composition } = current.session;
    measures = resolveMeasures(composition.measures);
    played = performance(composition);
    player.setComposition(composition);
    view.render(composition);
}

/** `z` shows every staff at once while editing; playback always does */
let zoomedOut = false;

function showEditing() {
    showTitle();
    view.fitHeight(zoomedOut);
    const { composition, editor } = current.session;
    const { mode, cursor } = editor;
    document.body.dataset['state'] = mode;
    modeLabel.textContent = MODE_LABELS[mode];
    showCommandLine(editor.commandLine);
    showPicker(editor.picker);
    const place = `${composition.parts[cursor.part]?.name ?? ''}  m${cursor.measure + 1}`;
    positionLabel.textContent = editor.phantom ? `${describePhantom(editor.phantom)}  ${place}` : place;

    view.setPlayhead(undefined);
    view.select(cursor);
    view.setSelection(editorSelection(composition, editor));
    view.setPhantom(editor.phantom, cursor);
    view.centerOn(cursor.measure, cursor.part);
}

function followPlayback() {
    if (!player.playing) {
        showEditing();
        return;
    }

    const seconds = player.position;
    const playing = playedMeasureAt(played, seconds);
    if (!playing) return;
    const { measure, startSeconds } = playing;
    const { tempo } = measures[measure]!;
    view.setPlayhead({ measure, time: (seconds - startSeconds) / secondsPerWholeNote(tempo) });
    view.centerOn(measure);
    positionLabel.textContent = `m${measure + 1}`;
    requestAnimationFrame(followPlayback);
}

function startPlayback() {
    const { composition, editor } = current.session;
    player.play(cursorSeconds(composition, editor.cursor));
    // Every part in view while it plays, however many there are
    view.fitHeight(true);
    document.body.dataset['state'] = 'playing';
    modeLabel.textContent = '-- PLAYING --';
    view.select(undefined);
    view.setSelection(undefined);
    view.setPhantom(undefined, editor.cursor);
    requestAnimationFrame(followPlayback);
}

/**
 * `:export`: renders through the score's soundfont in a worker, showing progress. Needs a
 * soundfont, since the stand-in tone is only for listening while writing.
 */
async function runExportCommand(command: Extract<Command, { name: 'export' }>) {
    const progress = (from: number, to: number) => (fraction: number) =>
        showMessage(`Exporting… ${Math.round((from + fraction * (to - from)) * 100)}%`);
    const render: Renderer = async (composition, format) => {
        // MIDI is the notes themselves, so it needs no soundfont, and it's quick
        if (format === 'midi') return writeMidi(composition);
        const path = composition.soundfont.filePath || soundfont?.path;
        if (!path) throw new Error('no soundfont to play it with; load one with :soundfont');
        const data = await window.files.readBinary(path);
        if (format === 'mp3') return exportMp3(composition, data, progress(0, 1));
        // A video's sound first, in the worker, then its frames here, where they can be drawn
        const audio = await renderPcm(composition, data, progress(0, 0.25));
        if (format === 'musanim') return exportMusanim(composition, audio, progress(0.25, 1));
        return exportVideo(composition, audio, progress(0.25, 1));
    };
    showMessage('Exporting…');
    const { message, error } = await runExport(command, current, window.files, render);
    showMessage(message, error);
}

/** Runs a `:` command the editor hands over: files, the window, soundfonts or exports */
async function run(command: Command) {
    if (command.name === 'soundfont') return runSoundfontCommand(command.path);
    if (command.name === 'export') return runExportCommand(command);
    if (!isFileCommand(command)) return;

    const before = current;
    const { document: after, message, error } = await runCommand(command, current, window.files, blankScore);
    current = after;
    if (after.session.composition !== before.session.composition) showComposition();
    showMessage(message, error);
    showEditing();
    if (after.session !== before.session) await loadScoreSoundfont();
}

/** The usual Mac shortcuts, beside `:w` and `:e` */
const SHORTCUTS: Record<string, () => Promise<Command | undefined>> = {
    s: async () => ({ name: 'write', force: false }),
    // Save As: the dialog asks before replacing a file, so it's forced past `:w`'s check
    S: async () => {
        const path = await window.files.chooseSavePath(current.path);
        return path ? { name: 'write', path, force: true } : undefined;
    },
    o: async () => {
        const path = await window.files.chooseOpenPath();
        return path ? { name: 'edit', path, force: false } : undefined;
    },
};

window.addEventListener('keydown', (event) => {
    const shortcutKey = event.shiftKey ? event.key.toUpperCase() : event.key;
    const shortcut = event.metaKey && !player.playing ? SHORTCUTS[shortcutKey] : undefined;
    if (shortcut) {
        event.preventDefault();
        void shortcut().then((command) => command && run(command));
        return;
    }

    const key = keyName(event);
    if (key === undefined) return;
    event.preventDefault();
    showMessage('');
    const { session } = current;

    // The whole command so far, so a finished `2<C-w>j` stays readable after its last key
    keysLabel.textContent = (player.playing ? '' : session.editor.pending) + key;

    // While playing, the only thing to do is stop; followPlayback switches back to editing
    if (player.playing) {
        if (key === '<Space>' || key === '<S-Space>' || key === '<Esc>') player.stop();
        return;
    }

    // The character typed, for the command line: Shift+3 is `#` on one keyboard and `§` on another
    const typed = event.key.length === 1 ? event.key : undefined;
    const { session: next, effect } = sessionKey(session, key, { text: typed, instruments });
    current = { ...current, session: next };
    // Edits, undo and redo all arrive as a new composition
    if (next.composition !== session.composition) showComposition();
    if (effect?.kind === 'preview') player.preview(effect.pitches, effect.part, effect.rolled);
    if (effect?.kind === 'audition') player.audition(effect.instrument, effect.pitch);
    if (effect?.kind === 'toggleZoom') zoomedOut = !zoomedOut;
    if (effect?.kind === 'command') void run(effect.command);
    if (effect?.kind === 'togglePlayback') startPlayback();
    else showEditing();
});

// Closing the window with changes is refused, like `:q`; `:q!` closes it regardless. Not in
// development, where it would block hot reloads
window.addEventListener('beforeunload', (event) => {
    if (import.meta.env.DEV || !isModified(current)) return;
    event.preventDefault();
    event.returnValue = false;
    showMessage('No write since last change (:w to save, :q! to quit without saving)', true);
});

// A new score starts with the soundfont last loaded
const { soundfont: defaultSoundfont } = await window.settings.get();
if (defaultSoundfont) {
    current = newDocument(setSoundfont(newComposition(), defaultSoundfont));
    player.setComposition(current.session.composition);
}

// Glyph metrics are wrong if we draw before the music font has loaded
await document.fonts.load('30px Bravura');
view.render(current.session.composition);
showEditing();
await loadScoreSoundfont();
