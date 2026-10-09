import { cursorSeconds } from '../../services/cursor/Cursor';
import { EditMode, EditorState, editorSelection, openMixer } from '../../services/editor/Editor';
import { keyName } from '../../services/editor/keys';
import { Command, isFileCommand } from '../../services/editor/CommandLine';
import { Picker, filterPaths, pickerItems } from '../../services/editor/Picker';
import { CLEFS, CLEF_NAMES, Clef, clefAt } from '../../services/clef/Clef';
import { Completion, completeCommandLine, completionText, cycleCompletion } from '../../services/editor/Completion';
import { Mixer } from '../../services/editor/MixerMode';
import { HelpView, matchesQuery } from '../../services/help/Help';
import { HELP_LINES } from '../../services/help/helpText';
import { MAX_PART_VOLUME, isAudible, masterVolume, partVolume } from '../../services/edit/Mixer';
import { setSoundfonts } from '../../services/edit/Parts';
import { Document, isModified, newDocument, runCommand } from '../../services/file/Commands';
import { Composition, newComposition } from '../../services/composition/Composition';
import { addSoundfont, describeSoundfonts, findSoundfont, soundfontName } from '../../services/soundfont/Soundfont';
import { GENERAL_MIDI_INSTRUMENTS, Instrument, partInstrument, sameSound } from '../../services/instrument/Instrument';
import { resolveMeasures, secondsPerWholeNote } from '../../services/measure/Measure';
import {
    PlayedMeasure,
    clockTime,
    nextPlayedMeasure,
    performance,
    performanceSeconds,
    playedMeasureAt,
} from '../../services/timeline/performance';
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
import type { Settings } from './env';

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
/** Scores opened or saved, newest first, kept in the settings */
let recentFiles: string[] = [];
const MAX_RECENT_FILES = 30;
/** Commands entered on the command line, newest first, also kept in the settings */
let commandHistory: string[] = [];
const MAX_COMMAND_HISTORY = 100;
const layers = new SoundfontLayers(audio);

const view = new ScoreView(document.querySelector<HTMLElement>('#viewport')!);
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
const commandLineLabel = document.querySelector<HTMLElement>('#command-line')!;
const messageLabel = document.querySelector<HTMLElement>('#message')!;
const keysLabel = document.querySelector<HTMLElement>('#keys')!;
const positionLabel = document.querySelector<HTMLElement>('#position')!;
const pickerPanel = document.querySelector<HTMLElement>('#picker')!;
const mixerPanel = document.querySelector<HTMLElement>('#mixer')!;
const partsPanel = document.querySelector<HTMLElement>('#parts')!;
const helpPanel = document.querySelector<HTMLElement>('#help')!;
const statusBar = document.querySelector<HTMLElement>('#status')!;
/** The manual's line height in pixels, as its CSS sets it */
const HELP_LINE_HEIGHT = 20;

const MODE_LABELS: Record<EditMode, string> = {
    normal: '',
    insert: '-- INSERT --',
    insertMelody: '-- INSERT MELODY --',
    visual: '-- VISUAL --',
    visualBlock: '-- VISUAL BLOCK --',
    command: '',
    picker: '',
    mixer: '-- MIXER --',
    parts: '-- PARTS --',
    help: '-- HELP --',
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

let settingsQueue: Promise<unknown> = Promise.resolve();

/** Changes the saved settings, one change at a time so none is lost to another */
function updateSettings(change: (settings: Settings) => Settings): Promise<void> {
    const updating = settingsQueue.then(async () => window.settings.set(change(await window.settings.get())));
    settingsQueue = updating.catch(() => undefined);
    return updating;
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
    await updateSettings(({ soundfont: _, ...settings }) => ({ ...settings, soundfonts: paths }));
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

/** What `:recent` offers: every recent score but the one open */
const recentChoices = () => recentFiles.filter((path) => path !== current.path);

/** Puts a score at the top of the recent ones, and saves the list */
async function rememberRecent(path: string) {
    recentFiles = [path, ...recentFiles.filter((recent) => recent !== path)].slice(0, MAX_RECENT_FILES);
    await updateSettings((settings) => ({ ...settings, recentFiles }));
}

/** Puts a command at the top of the history, once, and saves it */
async function rememberCommand(text: string) {
    const command = text.trim();
    if (!command) return;
    commandHistory = [command, ...commandHistory.filter((old) => old !== command)].slice(0, MAX_COMMAND_HISTORY);
    await updateSettings((settings) => ({ ...settings, commandHistory }));
}

/** The file names `<Tab>` is cycling through, while the command line still shows one of them */
let completion: Completion | undefined;

function setCommandText(text: string) {
    const { session } = current;
    current = { ...current, session: { ...session, editor: { ...session.editor, commandLine: { text } } } };
}

/** The matches in the status bar, a window of them around the one shown, which is marked */
function showMatches({ matches, index }: Completion) {
    const shown = 15;
    const first = Math.max(0, Math.min(index - Math.floor(shown / 2), matches.length - shown));
    const items = matches.slice(first, first + shown).map((match, i) =>
        Object.assign(document.createElement('span'), { className: first + i === index ? 'current' : '', textContent: match }),
    );
    const more = (count: number) => (count > 0 ? [Object.assign(document.createElement('span'), { textContent: `…${count} more` })] : []);
    messageLabel.classList.remove('error');
    messageLabel.replaceChildren(...more(first), ...items, ...more(matches.length - first - shown));
}

/**
 * `<Tab>` on the command line fills in a file name, from the score's folder unless it says
 * otherwise; again goes on to the next one, and `<S-Tab>` back
 */
async function completeFileName(step: 1 | -1) {
    const text = current.session.editor.commandLine?.text;
    if (text === undefined) return;
    if (completion && completionText(completion) === text) {
        completion = cycleCompletion(completion, step);
    } else {
        const list = async (typed: string) => window.files.list(await window.files.resolve(typed, folder(current.path)));
        const found = await completeCommandLine(text, list, step);
        // Typing carried on while the folder was read
        if (current.session.editor.commandLine?.text !== text) return;
        if (!found) return showMessage('No matching file', true);
        // A single match is done with, so another <Tab> completes inside it, if it's a folder
        completion = found.matches.length > 1 ? found : undefined;
        setCommandText(completionText(found));
    }
    if (completion) {
        setCommandText(completionText(completion));
        showMatches(completion);
    }
    showEditing();
}

/** A picker's heading, its list (a window of it around the selection), and a count beneath */
function showPickerPanel(heading: string, query: string | undefined, rows: HTMLLIElement[], selected: number, count: string) {
    const shown = 12;
    const first = Math.max(0, Math.min(selected - Math.floor(shown / 2), rows.length - shown));
    rows[selected]?.classList.add('selected');
    const list = document.createElement('ul');
    list.append(...rows.slice(first, first + shown));
    if (rows.length === 0) {
        list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No match' }));
    }
    pickerPanel.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'picker-heading', textContent: heading }),
        // Pickers with nothing to type have no filter to show
        ...(query === undefined ? [] : [Object.assign(document.createElement('div'), { className: 'picker-query', textContent: query })]),
        list,
        Object.assign(document.createElement('div'), { className: 'picker-count', textContent: count }),
    );
}

/** A row with a name, and a detail greyed out on the right */
function pickerRow(name: string, detail: string) {
    const row = document.createElement('li');
    row.append(name, Object.assign(document.createElement('span'), { textContent: detail }));
    return row;
}

/** `:recent`: the scores opened before, each by name with its folder */
function showRecentPicker(picker: Picker) {
    const choices = recentChoices();
    const items = filterPaths(choices, picker.query);
    const rows = items.map((path) => pickerRow(fileName(path), folder(path) ?? ''));
    const count = `${items.length} of ${choices.length} recent scores`;
    showPickerPanel('Open recent', picker.query, rows, picker.selected, count);
}

/** What sets each clef apart, beside its name */
const CLEF_DETAILS: Record<Clef, string> = {
    treble: 'G clef',
    bass: 'F clef',
    alto: 'C clef, middle C on the middle line',
    percussion: 'neutral, for drums',
    treble8va: 'sounds an octave higher',
    bass8vb: 'sounds an octave lower',
};

/** `gs`: the clefs, for the cursor's part from its measure on */
function showClefPicker(picker: Picker) {
    const { composition, editor } = current.session;
    const partName = composition.parts[editor.cursor.part]?.name ?? '';
    const rows = CLEFS.map((clef) => pickerRow(CLEF_NAMES[clef], CLEF_DETAILS[clef]));
    const heading = `Clef for ${partName} from measure ${editor.cursor.measure + 1}`;
    showPickerPanel(heading, undefined, rows, picker.selected, 'j k to move, <CR> to choose');
}

/** The instrument list over the score while choosing, like a fuzzy finder */
function showPicker(picker: Picker | undefined) {
    pickerPanel.hidden = !picker;
    if (!picker) return;
    if (picker.purpose === 'recent') return showRecentPicker(picker);
    if (picker.purpose === 'clef') return showClefPicker(picker);
    const items = pickerItems(picker, instruments);
    const partName = current.session.composition.parts[current.session.editor.cursor.part]?.name ?? '';
    const heading = picker.purpose === 'addPart' ? 'New part' : `Instrument for ${partName}`;

    const rows = items.map((instrument) => {
        const { bank, program, drums, soundfont } = instrument;
        const number = drums ? 'drums' : `${bank ? `${bank}:` : ''}${program + 1}`;
        // With several soundfonts, the same sound can come from any of them
        const from = soundfont && soundfonts.playing.length > 1 ? `${soundfontName(soundfont).replace(/\.[^.]*$/, '')}  ` : '';
        return pickerRow(instrument.name, from + number);
    });
    const [top, ...others] = soundfonts.playing;
    const more = others.length ? ` and ${others.length} more` : '';
    const source = top ? `in ${fileName(top)}${more}` : '(General MIDI, no soundfont loaded)';
    showPickerPanel(heading, picker.query, rows, picker.selected, `${items.length} of ${instruments.length} ${source}`);
}

/** The mixer over the score: each part's volume as a bar, muted or soloed, then the master's */
function showMixer(mixer: Mixer | undefined) {
    mixerPanel.hidden = !mixer;
    if (!mixer) return;
    const { composition } = current.session;
    const row = (name: string, percent: number, selected: boolean, flags: string, silent = false, master = false) => {
        const item = document.createElement('li');
        item.className = [selected && 'selected', master && 'master', silent && 'silent'].filter(Boolean).join(' ');
        const bar = Object.assign(document.createElement('span'), { className: 'mixer-bar' });
        // The bar runs to the loudest a part can go, with a tick at normal
        bar.append(Object.assign(document.createElement('span'), { className: 'mixer-level' }));
        bar.style.setProperty('--level', `${(percent / MAX_PART_VOLUME) * 100}%`);
        bar.style.setProperty('--normal', `${(100 / MAX_PART_VOLUME) * 100}%`);
        item.append(
            Object.assign(document.createElement('span'), { className: 'mixer-name', textContent: name }),
            bar,
            Object.assign(document.createElement('span'), { className: 'mixer-percent', textContent: `${percent}%` }),
            Object.assign(document.createElement('span'), { className: 'mixer-flags', textContent: flags }),
        );
        return item;
    };
    const list = document.createElement('ul');
    list.append(
        ...composition.parts.map((part, i) => {
            const flags = [part.muted && 'M', part.solo && 'S'].filter(Boolean).join(' ');
            return row(part.name, partVolume(part), mixer.selected === i, flags, !isAudible(composition, i));
        }),
        row('Master', masterVolume(composition), mixer.selected >= composition.parts.length, '', false, true),
    );
    mixerPanel.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'picker-heading', textContent: 'Mixer' }),
        list,
        Object.assign(document.createElement('div'), {
            className: 'picker-count',
            textContent: 'j/k part · h/l ±5 · H/L ±1 · = normal · m mute · s solo · Esc done',
        }),
    );
}

/** The parts list over the score: each part by name, with its instrument and clef */
function showParts(open: boolean) {
    partsPanel.hidden = !open;
    if (!open) return;
    const { composition, editor } = current.session;
    const list = document.createElement('ul');
    list.append(
        ...composition.parts.map((part, i) => {
            const played = partInstrument(part);
            const name = instruments.find((instrument) => sameSound(instrument, played))?.name ?? played.name;
            const row = pickerRow(`${i + 1}  ${part.name}`, `${name} · ${CLEF_NAMES[part.clef ?? 'treble']}`);
            if (i === editor.cursor.part) row.classList.add('selected');
            return row;
        }),
    );
    partsPanel.replaceChildren(
        Object.assign(document.createElement('div'), { className: 'picker-heading', textContent: 'Parts' }),
        list,
        Object.assign(document.createElement('div'), {
            className: 'picker-count',
            textContent: 'j/k part · J/K move · o/O add · d delete · u undo · Esc done',
        }),
    );
}

/** How many lines of the manual fit above the status bar */
const helpPageLines = () => Math.max(1, Math.floor((window.innerHeight - statusBar.offsetHeight) / HELP_LINE_HEIGHT));

/** Parts of a line, with every match for the search marked */
function markedLine(line: string, query: string | undefined): (string | HTMLElement)[] {
    if (!query || !matchesQuery(line, query)) return [line || ' '];
    const smart = query === query.toLowerCase();
    const haystack = smart ? line.toLowerCase() : line;
    const parts: (string | HTMLElement)[] = [];
    let from = 0;
    for (let at = haystack.indexOf(query); at !== -1; at = haystack.indexOf(query, at + query.length)) {
        parts.push(line.slice(from, at), Object.assign(document.createElement('mark'), { textContent: line.slice(at, at + query.length) }));
        from = at + query.length;
    }
    parts.push(line.slice(from));
    return parts;
}

/** The manual over the score, scrolled to its top line, with the search's matches marked */
function showHelp(help: HelpView | undefined) {
    helpPanel.hidden = !help;
    if (!help) return;
    helpPanel.style.bottom = `${statusBar.offsetHeight}px`;
    const rows = HELP_LINES.slice(help.top, help.top + helpPageLines() + 1).map((line, i) => {
        const row = document.createElement('div');
        if (/^[A-Z][A-Z ]*$/.test(line)) row.className = 'heading';
        if (help.top + i === help.match) row.classList.add('current');
        row.append(...markedLine(line, help.query));
        return row;
    });
    helpPanel.replaceChildren(...rows);
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

/** How far into the score a moment is, and how long it all takes, like 0:30 / 1:30 */
const timeIn = (seconds: number) => `${clockTime(seconds)} / ${clockTime(performanceSeconds(played))}`;

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
    showParts(mode === 'parts');
    showHelp(editor.help);
    if (editor.help) {
        // Typing a search takes over the status bar like the command line; a failed one says so
        commandLineLabel.hidden = editor.help.typing === undefined;
        const typing = Object.assign(document.createElement('span'), { className: 'command-text', textContent: editor.help.typing ?? '' });
        commandLineLabel.replaceChildren('/', typing);
        if (editor.help.error) showMessage(editor.help.error, true);
        positionLabel.textContent = `line ${editor.help.top + 1} of ${HELP_LINES.length}`;
        return;
    }
    const part = composition.parts[cursor.part];
    // The first time the cursor's measure is played
    const time = timeIn(cursorSeconds(composition, cursor, { skipRepeats }));
    const place = `${part?.name ?? ''}  m${cursor.measure + 1}  ${time}`;
    const clef = part && clefAt(part, cursor.measure);
    positionLabel.textContent = editor.phantom ? `${describePhantom(editor.phantom, clef)}  ${place}` : place;

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
    positionLabel.textContent = `m${measure + 1}  ${timeIn(seconds)}`;
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
    const mixer = current.session.editor.mode === 'mixer' ? ' MIXER' : '';
    modeLabel.textContent = skipRepeats ? `-- PLAYING (NO REPEATS)${mixer} --` : `-- PLAYING${mixer} --`;
}

/**
 * The mixer while playing: `m` opens it on the cursor's part, and its keys change the mix as it
 * plays, undone together like any visit. Space still stops, and `r` and `g` still go to playback.
 * The mixer stays open when playing stops.
 */
function playingMixerKey(key: string) {
    const { session } = current;
    if (session.editor.mode !== 'mixer') {
        if (key !== 'm') return;
        current = { ...current, session: { ...session, editor: openMixer(session.editor) } };
    } else {
        const next = sessionKey(session, key).session;
        current = { ...current, session: next };
        // Only the mix changed, so the notes keep playing as they are
        if (next.composition !== session.composition) player.setMix(next.composition);
    }
    showMixer(current.session.editor.mixer);
    showPlayingLabel();
    showTitle();
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
 * `g`, `h` and `l` while playing: carries on from the start, from the start of the measure
 * played before this one, so repeats are gone back through as they're played, or from the next
 * measure further on in the score, jumping over repeats
 */
function jumpPlayback(key: 'g' | 'h' | 'l') {
    const at = playedMeasureAt(played, player.position);
    const index = at ? played.indexOf(at) : 0;
    const target =
        key === 'g' ? played[0] : key === 'h' ? played[Math.max(0, index - 1)] : nextPlayedMeasure(played, index);
    // Past the last note there's nothing left to play
    if (!target || target.startSeconds >= player.end) return;
    player.stop();
    player.play(target.startSeconds);
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
    // Opening or saving a score makes it the most recent
    if (!error && after.path && command.name !== 'new' && command.name !== 'quit') void rememberRecent(after.path);
    showMessage(message, error);
    showEditing();
    if (after.session !== before.session) await loadScoreSoundfonts();
}

/**
 * Opens the score Finder asked for, like `:e`, so it's refused over unsaved changes. Playing
 * stops first, since playback only follows the score it started with.
 */
async function openFromFinder(path: string | undefined) {
    if (!path) return;
    if (player.playing) player.stop();
    await run({ name: 'edit', path, force: false });
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

    // While playing, the only things to do are stop, toggle repeats, jump and mix; followPlayback
    // switches back to editing
    if (player.playing) {
        const stop = key === '<Space>' || key === '<S-Space>';
        const mixing = session.editor.mode === 'mixer';
        if (stop || (key === '<Esc>' && !mixing)) player.stop();
        else if (key === 'r') toggleRepeats();
        else if (key === 'g' || (!mixing && (key === 'h' || key === 'l'))) jumpPlayback(key);
        else playingMixerKey(key);
        return;
    }

    if (session.editor.mode === 'command' && (key === '<Tab>' || key === '<S-Tab>')) {
        void completeFileName(key === '<Tab>' ? 1 : -1);
        return;
    }
    // Every command entered is remembered, even one with a mistake to fix
    if (session.editor.mode === 'command' && key === '<CR>') void rememberCommand(session.editor.commandLine?.text ?? '');

    // The character typed, for the command line: Shift+3 is `#` on one keyboard and `§` on another
    const typed = event.key.length === 1 ? event.key : undefined;
    const input = { text: typed, instruments, recentFiles: recentChoices(), commandHistory, helpPageLines: helpPageLines() };
    const { session: next, effect } = sessionKey(session, key, input);
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

// A new score starts with the soundfonts last chosen, and `:recent` offers the scores from before
const settings = await window.settings.get();
recentFiles = settings.recentFiles ?? [];
commandHistory = settings.commandHistory ?? [];
const defaultSoundfonts = settings.soundfonts ?? (settings.soundfont ? [settings.soundfont] : []);
if (defaultSoundfonts.length) {
    current = newDocument(setSoundfonts(newComposition(), defaultSoundfonts));
    player.setComposition(current.session.composition);
}

// Starting up offers the scores from before, like `:recent`; <Esc> keeps the new score. Not when
// vimscore was started by opening a score in Finder
const openedAtStart = await window.files.takeOpened();
if (!openedAtStart && recentChoices().length) {
    const picker: Picker = { purpose: 'recent', query: '', selected: 0 };
    const editor: EditorState = { ...current.session.editor, mode: 'picker', picker };
    current = { ...current, session: { ...current.session, editor } };
}

// Glyph metrics are wrong if we draw before the music font has loaded
await document.fonts.load('30px Bravura');
view.render(current.session.composition);
showEditing();
await loadScoreSoundfonts();

await openFromFinder(openedAtStart);
// Taken again after listening, in case one came in between
window.files.onOpened(async () => openFromFinder(await window.files.takeOpened()));
await openFromFinder(await window.files.takeOpened());
