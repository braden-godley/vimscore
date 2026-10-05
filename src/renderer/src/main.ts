import { withTrailingEmptyMeasure } from '../../services/composition/Composition';
import { exampleComposition } from '../../services/composition/example-composition';
import { cursorSeconds } from '../../services/cursor/Cursor';
import { EditMode, EditorState, editorSelection, handleKey, initialEditorState } from '../../services/editor/Editor';
import { keyName } from '../../services/editor/keys';
import { measureAtTime, resolveMeasures, secondsPerWholeNote } from '../../services/measure/Measure';
import { Player } from '../../services/player/Player';
import { ToneSynth } from '../../services/synth/ToneSynth';
import { ScoreView } from './score/ScoreView';

let composition = withTrailingEmptyMeasure(exampleComposition);
let measures = resolveMeasures(composition.measures);

const audio = new AudioContext();
const player = new Player(audio, new ToneSynth(audio));
player.setComposition(composition);

const view = new ScoreView(document.querySelector<HTMLElement>('#viewport')!);
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
const keysLabel = document.querySelector<HTMLElement>('#keys')!;
const positionLabel = document.querySelector<HTMLElement>('#position')!;

const MODE_LABELS: Record<EditMode, string> = {
    normal: '',
    insert: '-- INSERT --',
    visual: '-- VISUAL --',
    visualBlock: '-- VISUAL BLOCK --',
};

/** The app is either playing, following the playhead, or editing, following the cursor */
let editor: EditorState = initialEditorState(composition);

function showEditing() {
    const { mode, cursor } = editor;
    document.body.dataset['state'] = mode;
    modeLabel.textContent = MODE_LABELS[mode];
    positionLabel.textContent = `${composition.parts[cursor.part]?.name ?? ''}  m${cursor.measure + 1}`;

    view.setPlayhead(undefined);
    view.select(cursor);
    view.setSelection(editorSelection(composition, editor));
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
    player.play(cursorSeconds(composition, editor.cursor));
    document.body.dataset['state'] = 'playing';
    modeLabel.textContent = '-- PLAYING --';
    view.select(undefined);
    view.setSelection(undefined);
    requestAnimationFrame(followPlayback);
}

window.addEventListener('keydown', (event) => {
    const key = keyName(event);
    if (key === undefined) return;
    event.preventDefault();

    // The whole command so far, so a finished `2<C-w>j` stays readable after its last key
    keysLabel.textContent = (player.playing ? '' : editor.pending) + key;

    // While playing, the only thing to do is stop; followPlayback switches back to editing
    if (player.playing) {
        if (key === '<Space>' || key === '<Esc>') player.stop();
        return;
    }

    const result = handleKey(composition, editor, key);
    editor = result.state;
    if (result.composition && result.composition !== composition) {
        composition = withTrailingEmptyMeasure(result.composition);
        measures = resolveMeasures(composition.measures);
        player.setComposition(composition);
        view.render(composition);
    }
    if (result.effect?.kind === 'preview') player.preview(result.effect.pitches);
    if (result.effect?.kind === 'togglePlayback') startPlayback();
    else showEditing();
});

// Glyph metrics are wrong if we draw before the music font has loaded
await document.fonts.load('30px Bravura');
view.render(composition);
showEditing();
