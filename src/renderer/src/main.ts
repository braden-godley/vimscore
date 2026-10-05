// The Bravura entry bundles only the Bravura + Academico fonts, not all five
import { Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import { exampleComposition } from '../../services/composition/example-composition';
import { Player } from '../../services/player/Player';
import { ToneSynth } from '../../services/synth/ToneSynth';

async function renderDemo(container: HTMLDivElement): Promise<void> {
    // Glyph metrics are wrong if we draw before the music font has loaded
    await document.fonts.load('30px Bravura');

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(520, 140);
    const context = renderer.getContext();

    const stave = new Stave(10, 20, 500);
    stave.addClef('treble').addTimeSignature('4/4');
    stave.setContext(context).draw();

    const notes = ['c/4', 'e/4', 'g/4', 'c/5'].map(
        (key) => new StaveNote({ keys: [key], duration: 'q' }),
    );
    const voice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], 440);
    voice.draw(context, stave);
}

renderDemo(document.querySelector<HTMLDivElement>('#score')!);

const audio = new AudioContext();
const player = new Player(audio, new ToneSynth(audio));
player.setComposition(exampleComposition);

document.querySelector('#play')!.addEventListener('click', () => player.play());
document.querySelector('#stop')!.addEventListener('click', () => player.stop());
