/**
 * Makes an MP4 of the score playing: every stave fitted to the frame, the music scrolling past
 * a centered red playhead, staff names kept at the left, and the title across the top. Frames
 * are drawn as fast as they encode rather than in real time, so the video is smooth and in
 * sync on any machine. Encoding is Chromium's (H.264 and AAC through WebCodecs); mediabunny
 * puts them in the MP4.
 */

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { Composition } from '../../../services/composition/Composition';
import { RenderedAudio } from '../../../services/export/renderAudio';
import { resolveMeasures, secondsPerWholeNote } from '../../../services/measure/Measure';
import { performance, playedMeasureAt } from '../../../services/timeline/performance';
import { LEFT_MARGIN, NAME_FONT, ScoreLayout, interpolate, renderScore } from '../score/renderScore';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
/** Room across the top for the title */
const TITLE_HEIGHT = 120;
const MARGIN = 40;
/** A short score is drawn up to this much bigger than in the editor, not stretched to fill */
const MAX_SCALE = 1.6;
/** The widest canvas each piece of the score is drawn on; canvases have a size limit */
const TILE_WIDTH = 4096;
/** How far the playhead reaches above the top stave and below the bottom one */
const PLAYHEAD_OVERHANG = 24;

/** Where everything goes on the frame */
interface Framing {
    layout: ScoreLayout;
    /** How far above and below the layout the drawing reaches, in score units */
    drawnTop: number;
    drawnHeight: number;
    scale: number;
    /** Where the top of the drawing goes on the frame */
    scoreTop: number;
}

/** Lays the score out once in the page, off screen, to measure it */
function measure(composition: Composition): Framing {
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; left: -100000px; top: 0; visibility: hidden';
    document.body.append(container);
    try {
        const layout = renderScore(container, composition);
        const box = container.querySelector('svg')?.getBBox();
        const drawnTop = Math.min(0, box?.y ?? 0);
        const drawnBottom = Math.max(layout.height, box ? box.y + box.height : 0);
        const drawnHeight = drawnBottom - drawnTop;
        const available = HEIGHT - TITLE_HEIGHT - MARGIN;
        const scale = Math.min(MAX_SCALE, available / drawnHeight);
        const scoreTop = TITLE_HEIGHT + (available - drawnHeight * scale) / 2;
        return { layout, drawnTop, drawnHeight, scale, scoreTop };
    } finally {
        container.remove();
    }
}

/** The whole score as pictures, each up to TILE_WIDTH wide, left to right */
function drawTiles(composition: Composition, { layout, drawnTop, drawnHeight, scale }: Framing): HTMLCanvasElement[] {
    const tileScoreWidth = TILE_WIDTH / scale;
    const count = Math.ceil(layout.width / tileScoreWidth);
    return Array.from({ length: count }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = TILE_WIDTH;
        canvas.height = Math.ceil(drawnHeight * scale);
        const context = canvas.getContext('2d')!;
        renderScore({ canvas: context, left: i * tileScoreWidth, top: drawnTop, scale }, composition);
        return canvas;
    });
}

/** Where the playhead is at any time, in score units across the layout, following repeats */
function playheadFor(composition: Composition, layout: ScoreLayout): (seconds: number) => number {
    const resolved = resolveMeasures(composition.measures);
    const played = performance(composition);
    return (seconds) => {
        const playing = playedMeasureAt(played, seconds);
        const box = playing && layout.measures[playing.measure];
        if (!playing || !box) return 0;
        const wholeNotes = (seconds - playing.startSeconds) / secondsPerWholeNote(resolved[playing.measure]!.tempo);
        return interpolate(box.anchors, wholeNotes);
    };
}

function drawFrame(
    context: CanvasRenderingContext2D,
    composition: Composition,
    framing: Framing,
    tiles: HTMLCanvasElement[],
    playhead: number,
) {
    const { layout, drawnTop, scale, scoreTop } = framing;
    const visibleWidth = WIDTH / scale;
    // The playhead stays centered, except near the ends, where the score stops scrolling
    const left =
        layout.width <= visibleWidth
            ? (layout.width - visibleWidth) / 2
            : Math.max(0, Math.min(layout.width - visibleWidth, playhead - visibleWidth / 2));

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.fillStyle = '#111';
    context.font = '44px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(composition.title, WIDTH / 2, TITLE_HEIGHT / 2);

    const tileScoreWidth = TILE_WIDTH / scale;
    tiles.forEach((tile, i) => {
        const x = (i * tileScoreWidth - left) * scale;
        if (x < WIDTH && x + TILE_WIDTH > 0) context.drawImage(tile, x, scoreTop);
    });

    // Score units to frame pixels, vertically
    const y = (scoreY: number) => scoreTop + (scoreY - drawnTop) * scale;
    const first = layout.parts[0];
    const last = layout.parts.at(-1);
    if (first && last) {
        context.fillStyle = 'rgba(217, 48, 37, 0.75)';
        const top = y(first.top) - PLAYHEAD_OVERHANG;
        context.fillRect((playhead - left) * scale - 1.5, top, 3, y(last.bottom) + PLAYHEAD_OVERHANG - top);
    }

    // Once the names at the start have scrolled away, they're kept at the left edge
    if (left > LEFT_MARGIN) {
        context.font = NAME_FONT.replace(/^\d+px/, `${Math.round(13 * Math.max(1, scale))}px`);
        context.textAlign = 'left';
        composition.parts.forEach(({ name }, p) => {
            const stave = layout.parts[p];
            if (!stave) return;
            const centre = y((stave.top + stave.bottom) / 2);
            const width = context.measureText(name).width + 24;
            context.fillStyle = 'rgba(255, 255, 255, 0.9)';
            context.fillRect(0, centre - 14, width, 28);
            context.fillStyle = '#333';
            context.fillText(name, 12, centre);
        });
    }
}

/** Gives the page a moment to show progress */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function exportVideo(
    composition: Composition,
    audio: RenderedAudio,
    onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
    const framing = measure(composition);
    const tiles = drawTiles(composition, framing);
    onProgress(0.05);

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d')!;

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
    const sound = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') });
    output.addVideoTrack(video, { frameRate: FPS });
    output.addAudioTrack(sound);
    await output.start();

    const playheadAt = playheadFor(composition, framing.layout);
    const seconds = audio.left.length / audio.sampleRate;
    const frames = Math.ceil(seconds * FPS);
    for (let frame = 0; frame < frames; frame++) {
        const time = frame / FPS;
        drawFrame(context, composition, framing, tiles, playheadAt(time));
        await video.add(time, 1 / FPS);
        if (frame % FPS === 0) {
            onProgress(0.05 + 0.9 * (frame / frames));
            await breathe();
        }
    }

    const buffer = new AudioBuffer({ numberOfChannels: 2, length: audio.left.length, sampleRate: audio.sampleRate });
    buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
    await sound.add(buffer);
    await output.finalize();
    onProgress(1);
    return new Uint8Array(output.target.buffer!);
}
