import { cursorSeconds } from '../../services/cursor/Cursor';
import { EditMode, EditorState, editorSelection } from '../../services/editor/Editor';
import { keyName } from '../../services/editor/keys';
import { Command, isFileCommand } from '../../services/editor/CommandLine';
import { Picker, pickerItems } from '../../services/editor/Picker';
import { Mixer } from '../../services/editor/MixerMode';
import { MAX_PART_VOLUME, masterVolume, partVolume } from '../../services/edit/Mixer';
import { setSoundfonts } from '../../services/edit/Parts';
import { Document, isModified, newDocument, runCommand } from '../../services/file/Commands';
import { Composition, newComposition } from '../../services/composition/Composition';
import { addSoundfont, describeSoundfonts, findSoundfont, soundfontName } from '../../services/soundfont/Soundfont';
import { GENERAL_MIDI_INSTRUMENTS, Instrument } from '../../services/instrument/Instrument';
import { resolveMeasures, secondsPerWholeNote } from '../../services/measure/Measure';
import { PlayedMeasure, performance, playedMeasureAt } from '../../services/timeline/performance';
import { Player } from '../../services/player/Player';
import { sessionEdit, sessionKey } from '../../services/session/Session';
import { ToneSynth } from '../../services/synth/ToneSynth';
import { writeMidi } from '../../services/export/midi';
import { Renderer, runExport } from '../../services/export/runExport';
import { SoundfontLayers } from './audio/SoundfontLayers';
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
/** `r` while playing skips repeats or plays them again, and later plays keep the choice */
let skipRepeats = false;

const audio = new AudioContext();
const tone = new ToneSynth(audio);
const synth = new SwitchableSynth(tone);
const player = new Player(audio, synth);
player.setComposition(current.session.composition);

/**
 * The soundfonts asked for, first taking precedence, and the ones playing: all of them unless
 * some couldn't be loaded. Their instruments, or General MIDI's names until one loads.
 */
let soundfonts: { requested: string[]; playing: string[] } = { requested: [], playing: [] };
let instruments: Instrument[] = GENERAL_MIDI_INSTRUMENTS;
let soundfontQueue: Promise<unknown> = Promise.resolve();
const layers = new SoundfontLayers(audio);

const view = new ScoreView(document.querySelector<HTMLElement>('#viewport')!);
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
const commandLineLabel = document.querySelector<HTMLElement>('#command-line')!;
const messageLabel = document.querySelector<HTMLElement>('#message')!;
const keysLabel = document.querySelector<HTMLElement>('#keys')!;
const positionLabel = document.querySelector<HTMLElement>('#position')!;
const pickerPanel = document.querySelector<HTMLElement>('#picker')!;
const mixerPanel = document.querySelector<HTMLElement>('#mixer')!;

const MODE_LABELS: Record<EditMode, string> = {
    normal: '',
    insert: '-- INSERT --',
    insertMelody: '-- INSERT MELODY --',
    visual: '-- VISUAL --',
    visualBlock: '-- VISUAL BLOCK --',
    command: '',
    picker: '',
    mixer: '-- MIXER --',
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string | undefined) => path?.replace(/[\\/][^\\/]*$/, '');

const scoreSoundfonts = (composition: Composition) => composition.soundfonts.map(({ filePath }) => filePath);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((path, i) => path === b[i]);

/**
 * Plays through these soundfonts from now on, the first taking precedence; none is the stand-in
 * tone. The worklet starts the first time. Returns an error to show for any that can't be read
 * or aren't soundfonts, which are left out; if one of `required` fails, the old sound stays.
 * One loads at a time, in the order asked for.
 */
function loadSoundfonts(paths: string[], options: { required?: string[] } = {}): Promise<string | undefined> {
    const loading = soundfontQueue.then(() => loadSoundfontsNow(paths, options));
    soundfontQueue = loading;
    return loading;
}

async function loadSoundfontsNow(paths: string[], { required = [] as string[] }): Promise<string | undefined> {
    if (sameList(paths, soundfonts.requested)) return undefined;
    try {
        const result = await layers.load(paths, (path) => window.files.readBinary(path), { required });
        const playing = paths.filter((path) => !result.failed.some((failure) => failure.path === path));
        soundfonts = { requested: paths, playing };
        instruments = playing.length ? result.instruments : GENERAL_MIDI_INSTRUMENTS;
        synth.use(playing.length ? layers : tone);
        const failures = result.failed.map(({ path, message }) => `"${soundfontName(path)}": ${message}`);
        return failures.length ? `Can't load soundfont ${failures.join('; ')}` : undefined;
    } catch (error) {
        return `Can't load soundfont ${(error as Error).message}`;
    }
}

/** A new score, with the soundfonts last loaded */
function blankScore() {
    return setSoundfonts(newComposition(), soundfonts.requested);
}

/** Loads the soundfonts a score names, if they aren't playing already: on opening it, or an undo */
async function loadScoreSoundfonts() {
    const error = await loadSoundfonts(scoreSoundfonts(current.session.composition));
    if (error) showMessage(error, true);
}

/** Changes the score's soundfonts (undoably), and makes them the ones new scores start with */
async function changeSoundfonts(paths: string[], message: string) {
    const { session } = current;
    current = { ...current, session: sessionEdit(session, setSoundfonts(session.composition, paths)) };
    const { soundfont: _, ...settings } = await window.settings.get();
    await window.settings.set({ ...settings, soundfonts: paths });
    showMessage(message);
    showEditing();
}

/**
 * `:soundfont [path]` plays through just that one, and `:addsf [path]` puts it over the others.
 * Either asks with a dialog when there's no path, and changes nothing if it can't be loaded.
 */
async function runSoundfontCommand(typed: string | undefined, add: boolean) {
    const chosen = typed
        ? await window.files.resolve(typed, folder(current.path))
        : await window.files.chooseSoundfontPath();
    if (!chosen) return;
    const paths = add ? addSoundfont(current.session.composition.soundfonts, chosen).map(({ filePath }) => filePath) : [chosen];
    const error = await loadSoundfonts(paths, { required: [chosen] });
    // Already asked for and failed, it isn't loaded again
    if (!soundfonts.playing.includes(chosen)) {
        showMessage(error ?? `Can't load soundfont "${fileName(chosen)}"`, true);
        return;
    }
    const others = paths.length > 1 ? `, over ${paths.length - 1} more` : '';
    await changeSoundfonts(paths, `"${fileName(chosen)}" ${instruments.length} instruments${others}`);
    // Another of them may not have loaded
    if (error) showMessage(error, true);
}

/** `:delsf 2` or `:delsf name` */
async function runDeleteSoundfontCommand(which: string) {
    const { soundfonts: list } = current.session.composition;
    const index = findSoundfont(list, which);
    if (index === undefined) {
        showMessage(`No soundfont ${which}: ${describeSoundfonts(list)}`, true);
        return;
    }
    const rest = list.filter((_, i) => i !== index);
    const paths = rest.map(({ filePath }) => filePath);
    const error = await loadSoundfonts(paths);
    await changeSoundfonts(paths, `"${soundfontName(list[index]!.filePath)}" removed; ${describeSoundfonts(rest)}`);
    if (error) showMessage(error, true);
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
        const { bank, program, drums, soundfont } = instrument;
        const number = drums ? 'drums' : `${bank ? `${bank}:` : ''}${program + 1}`;
        // With several soundfonts, the same sound can come from any of them
        const from = soundfont && soundfonts.playing.length > 1 ? `${soundfontName(soundfont).replace(/\.[^.]*$/, '')}  ` : '';
        const detail = from + number;
        row.append(instrument.name, Object.assign(document.createElement('span'), { textContent: detail }));
        return row;
    });
    const list = document.createElement('ul');
    list.append(...rows);
    if (items.length === 0) {
        list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No match' }));
    }
    const [top, ...others] = soundfonts.playing;
    const more = others.length ? ` and ${others.length} more` : '';
    const source = top ? `in ${fileName(top)}${more}` : '(General MIDI, no soundfont loaded)';

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

/** The mixer over the score: each part's volume as a bar, then the master's */
function showMixer(mixer: Mixer | undefined) {
    mixerPanel.hidden = !mixer;
    if (!mixer) return;
    const { composition } = current.session;
    const row = (name: string, percent: number, selected: boolean, master = false) => {
        const item = document.createElement('li');
        item.className = [selected && 'selected', master && 'master'].filter(Boolean).join(' ');
        const bar = Object.assign(document.createElement('span'), { className: 'mixer-bar' });
        // The bar runs to the loudest a part can go, with a tick at normal
        bar.append(Object.assign(document.createElement('span'), { className: 'mixer-level' }));
        bar.style.setProperty('--level', `${(percent / MAX_PART_VOLUME) * 100}%`);
        bar.style.setProperty('--normal', `${(100 / MAX_PART_VOLUME) * 100}%`);
        item.append(
            Object.assign(document.createElement('span'), { className: 'mixer-name', textContent: name }),
            bar,
            Object.assign(document.createElement('span'), { className: 'mixer-percent', textContent: `${percent}%` }),
        );
        return item;
    };
    const list = document.createElement('ul');
    list.append(
        ...composition.parts.map((part, i) => row(part.name, partVolume(part), mixer.selected === i)),
        row('Master', masterVolume(composition), mixer.selected >= composition.parts.length, true),
    );
    mixerPanel.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'picker-heading', textContent: 'Mixer' }),
        list,
        Object.assign(document.createElement('div'), {
            className: 'picker-count',
            textContent: 'j/k part · h/l ±5 · H/L ±1 · = normal · Esc done',
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
    played = performance(composition, { skipRepeats });
    player.setComposition(composition, { skipRepeats });
    view.render(composition);
    // An undo can take a soundfont change back
    if (!sameList(scoreSoundfonts(composition), soundfonts.requested)) void loadScoreSoundfonts();
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
    showMixer(editor.mixer);
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
    player.play(cursorSeconds(composition, editor.cursor, { skipRepeats }));
    // Every part in view while it plays, however many there are
    view.fitHeight(true);
    document.body.dataset['state'] = 'playing';
    showPlayingLabel();
    view.select(undefined);
    view.setSelection(undefined);
    view.setPhantom(undefined, editor.cursor);
    requestAnimationFrame(followPlayback);
}

function showPlayingLabel() {
    modeLabel.textContent = skipRepeats ? '-- PLAYING (NO REPEATS) --' : '-- PLAYING --';
}

/** `r` while playing: skips repeats or plays them, carrying on from the same moment of the same measure */
function toggleRepeats() {
    const seconds = player.position;
    const at = playedMeasureAt(played, seconds);
    skipRepeats = !skipRepeats;
    const { composition } = current.session;
    played = performance(composition, { skipRepeats });
    player.setComposition(composition, { skipRepeats });
    // The first time that measure comes round now
    const same = at && played.find(({ measure }) => measure === at.measure);
    player.play(same ? same.startSeconds + seconds - at.startSeconds : 0);
    showPlayingLabel();
    showMessage(skipRepeats ? 'Skipping repeats' : 'Playing repeats');
}

/**
 * `:export`: renders through the score's soundfonts in a worker, showing progress. Needs one,
 * since the stand-in tone is only for listening while writing.
 */
async function runExportCommand(command: Extract<Command, { name: 'export' }>) {
    const progress = (from: number, to: number) => (fraction: number) =>
        showMessage(`Exporting… ${Math.round((from + fraction * (to - from)) * 100)}%`);
    const render: Renderer = async (composition, format) => {
        // MIDI is the notes themselves, so it needs no soundfont, and it's quick
        if (format === 'midi') return writeMidi(composition);
        const paths = composition.soundfonts.length ? scoreSoundfonts(composition) : soundfonts.playing;
        if (paths.length === 0) throw new Error('no soundfont to play it with; load one with :soundfont');
        const data = await Promise.all(paths.map(async (path) => ({ path, data: await window.files.readBinary(path) })));
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
    if (command.name === 'soundfont') return runSoundfontCommand(command.path, false);
    if (command.name === 'addSoundfont') return runSoundfontCommand(command.path, true);
    if (command.name === 'deleteSoundfont') return runDeleteSoundfontCommand(command.which);
    if (command.name === 'listSoundfonts') return showMessage(describeSoundfonts(current.session.composition.soundfonts));
    if (command.name === 'export') return runExportCommand(command);
    if (!isFileCommand(command)) return;

    const before = current;
    const { document: after, message, error } = await runCommand(command, current, window.files, blankScore);
    current = after;
    if (after.session.composition !== before.session.composition) showComposition();
    showMessage(message, error);
    showEditing();
    if (after.session !== before.session) await loadScoreSoundfonts();
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

    // While playing, the only things to do are stop or toggle repeats; followPlayback switches back to editing
    if (player.playing) {
        if (key === '<Space>' || key === '<S-Space>' || key === '<Esc>') player.stop();
        if (key === 'r') toggleRepeats();
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

// A new score starts with the soundfonts last chosen
const settings = await window.settings.get();
const defaultSoundfonts = settings.soundfonts ?? (settings.soundfont ? [settings.soundfont] : []);
if (defaultSoundfonts.length) {
    current = newDocument(setSoundfonts(newComposition(), defaultSoundfonts));
    player.setComposition(current.session.composition);
}

// Glyph metrics are wrong if we draw before the music font has loaded
await document.fonts.load('30px Bravura');
view.render(current.session.composition);
showEditing();
await loadScoreSoundfonts();
