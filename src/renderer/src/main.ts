import { newComposition } from '../../services/composition/Composition';
import { cursorSeconds } from '../../services/cursor/Cursor';
import { EditMode, editorSelection } from '../../services/editor/Editor';
import { PROMPT_LABELS, Prompt } from '../../services/editor/Prompt';
import { keyName } from '../../services/editor/keys';
import { measureAtTime, resolveMeasures, secondsPerWholeNote } from '../../services/measure/Measure';
import { Player } from '../../services/player/Player';
import { sessionKey, startSession } from '../../services/session/Session';
import { ToneSynth } from '../../services/synth/ToneSynth';
import { ScoreView } from './score/ScoreView';
import { describePhantom } from './score/notation';

/** The app is either playing, following the playhead, or editing, following the cursor */
let session = startSession(newComposition());
let measures = resolveMeasures(session.composition.measures);

const audio = new AudioContext();
const player = new Player(audio, new ToneSynth(audio));
player.setComposition(session.composition);

const view = new ScoreView(document.querySelector<HTMLElement>('#viewport')!);
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
const promptLabel = document.querySelector<HTMLElement>('#prompt')!;
const keysLabel = document.querySelector<HTMLElement>('#keys')!;
const positionLabel = document.querySelector<HTMLElement>('#position')!;

const MODE_LABELS: Record<EditMode, string> = {
    normal: '',
    insert: '-- INSERT --',
    insertMelody: '-- INSERT MELODY --',
    visual: '-- VISUAL --',
    visualBlock: '-- VISUAL BLOCK --',
    prompt: '',
};

/** A prompt takes over the status bar, like vim's command line */
function showPrompt(prompt: Prompt | undefined) {
    promptLabel.hidden = !prompt;
    if (!prompt) return;
    const { label, example } = PROMPT_LABELS[prompt.kind];
    promptLabel.replaceChildren(
        `${label} from m${prompt.measure + 1}: `,
        Object.assign(document.createElement('span'), { className: 'prompt-text', textContent: prompt.text }),
        Object.assign(document.createElement('span'), {
            className: prompt.error ? 'prompt-error' : 'prompt-hint',
            textContent: prompt.error ?? `  ${example}`,
        }),
    );
}

function showEditing() {
    const { composition, editor } = session;
    const { mode, cursor } = editor;
    document.body.dataset['state'] = mode;
    modeLabel.textContent = MODE_LABELS[mode];
    showPrompt(editor.prompt);
    const place = `${composition.parts[cursor.part]?.name ?? ''}  m${cursor.measure + 1}`;
    const key = measures[cursor.measure]?.keySignature;
    positionLabel.textContent = editor.phantom ? `${describePhantom(editor.phantom, key)}  ${place}` : place;

    view.setPlayhead(undefined);
    view.select(cursor);
    view.setSelection(editorSelection(composition, editor));
    view.setPhantom(editor.phantom, cursor);
    view.centerOn(cursor.measure);
}

function followPlayback() {
    if (!player.playing) {
        showEditing();
        return;
    }

    const seconds = player.position;
    const measure = measureAtTime(measures, seconds);
    const { startSeconds, tempo } = measures[measure]!;
    view.setPlayhead({ measure, time: (seconds - startSeconds) / secondsPerWholeNote(tempo) });
    view.centerOn(measure);
    positionLabel.textContent = `m${measure + 1}`;
    requestAnimationFrame(followPlayback);
}

function startPlayback() {
    const { composition, editor } = session;
    player.play(cursorSeconds(composition, editor.cursor));
    document.body.dataset['state'] = 'playing';
    modeLabel.textContent = '-- PLAYING --';
    view.select(undefined);
    view.setSelection(undefined);
    view.setPhantom(undefined, editor.cursor);
    requestAnimationFrame(followPlayback);
}

window.addEventListener('keydown', (event) => {
    const key = keyName(event);
    if (key === undefined) return;
    event.preventDefault();

    // The whole command so far, so a finished `2<C-w>j` stays readable after its last key
    keysLabel.textContent = (player.playing ? '' : session.editor.pending) + key;

    // While playing, the only thing to do is stop; followPlayback switches back to editing
    if (player.playing) {
        if (key === '<Space>' || key === '<Esc>') player.stop();
        return;
    }

    const previous = session.composition;
    // The character typed, for prompts: Shift+3 is `#` on one keyboard and `§` on another
    const typed = event.key.length === 1 ? event.key : undefined;
    const { session: next, effect } = sessionKey(session, key, typed);
    session = next;
    // Edits, undo and redo all arrive as a new composition
    if (session.composition !== previous) {
        measures = resolveMeasures(session.composition.measures);
        player.setComposition(session.composition);
        view.render(session.composition);
    }
    if (effect?.kind === 'preview') player.preview(effect.pitches);
    if (effect?.kind === 'togglePlayback') startPlayback();
    else showEditing();
});

// Glyph metrics are wrong if we draw before the music font has loaded
await document.fonts.load('30px Bravura');
view.render(session.composition);
showEditing();
