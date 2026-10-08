/**
 * `:export musanim`: the music as light rather than notation, after the Music Animation Machine.
 * On black, every note is a star in its part's color, as high as its pitch, trailing a tail of
 * light as long as it sounds, scrolling right to left past the middle of the frame. Notes
 * drift in from the right, speed up through the middle, stretching out as they go, and slow
 * again as they leave. A note sparkles where it sounds, flaring as it starts, and dims once
 * it's passed. The edges of the frame fade to black, so notes glow in and out of view. The
 * title and the parts' names show at the start, then fade away.
 */

import { Composition } from '../../../services/composition/Composition';
import { Rgb, lighten, notesBetween, partColor, pitchRange, unwarp, warp } from '../../../services/export/musanim';
import { RenderedAudio } from '../../../services/export/renderAudio';
import { TimedNote, timeline } from '../../../services/timeline/timeline';
import { HEIGHT, WIDTH, encodeVideo } from './encode';

/** Where "now" is: notes sound as they cross the middle */
const NOW_X = WIDTH / 2;
/** How fast the music moves through the middle, in pixels a second */
const CENTER_SPEED = 440;
/**
 * How far from the middle the music would get if it never stopped slowing. Past the frame's
 * edge, so notes keep moving on and off it (about four seconds out) rather than piling up.
 */
const REACH = NOW_X * 1.3;
const MARGIN = 48;
/** How far in from each side the frame fades up from black */
const EDGE_FADE = 380;
/** How quickly the flare as a note starts dies down, in seconds */
const FLARE_SECONDS = 0.3;
/** How long the title and names stay, then how long they take to fade */
const INTRO_SECONDS = 4;
const FADE_SECONDS = 1.5;
/** The size the glow and sparkle pictures are drawn at, before scaling */
const SPRITE = 128;

const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;

/** A soft round glow: a white-hot core fading out through the color */
function glowSprite(color: Rgb): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE;
    const context = canvas.getContext('2d')!;
    const middle = SPRITE / 2;
    const gradient = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
    gradient.addColorStop(0, rgba(lighten(color, 0.9), 1));
    gradient.addColorStop(0.1, rgba(lighten(color, 0.5), 0.95));
    gradient.addColorStop(0.3, rgba(color, 0.4));
    gradient.addColorStop(0.6, rgba(color, 0.1));
    gradient.addColorStop(1, rgba(color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, SPRITE, SPRITE);
    return canvas;
}

/** A star's four rays: thin lines through the middle, brightest there and fading out */
function sparkleSprite(color: Rgb): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE;
    const context = canvas.getContext('2d')!;
    const middle = SPRITE / 2;
    const ray = (horizontal: boolean) => {
        const gradient = horizontal
            ? context.createLinearGradient(0, 0, SPRITE, 0)
            : context.createLinearGradient(0, 0, 0, SPRITE);
        gradient.addColorStop(0, rgba(color, 0));
        gradient.addColorStop(0.5, rgba(lighten(color, 0.8), 1));
        gradient.addColorStop(1, rgba(color, 0));
        context.fillStyle = gradient;
        if (horizontal) context.fillRect(0, middle - 1.5, SPRITE, 3);
        else context.fillRect(middle - 1.5, 0, 3, SPRITE);
    };
    ray(true);
    ray(false);
    return canvas;
}

function drawIntro(context: CanvasRenderingContext2D, composition: Composition, seconds: number) {
    const alpha = Math.max(0, Math.min(1, (INTRO_SECONDS + FADE_SECONDS - seconds) / FADE_SECONDS));
    if (alpha === 0) return;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
    context.font = '56px Georgia, serif';
    context.fillText(composition.title, MARGIN * 1.5, MARGIN * 2);
    context.font = '28px Georgia, serif';
    composition.parts.forEach(({ name }, p) => {
        const y = MARGIN * 2 + 70 + p * 40;
        context.fillStyle = rgba(partColor(p), alpha);
        context.beginPath();
        context.arc(MARGIN * 1.5 + 12, y, 9, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = `rgba(255, 255, 255, ${0.8 * alpha})`;
        context.fillText(name, MARGIN * 1.5 + 40, y);
    });
}

/** Black over each side, solid at the edge and clearing toward the middle */
function fadeEdges(context: CanvasRenderingContext2D) {
    for (const [from, to] of [
        [0, EDGE_FADE],
        [WIDTH, WIDTH - EDGE_FADE],
    ] as const) {
        const gradient = context.createLinearGradient(from, 0, to, 0);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.fillRect(Math.min(from, to), 0, EDGE_FADE, HEIGHT);
    }
}

export async function exportMusanim(
    composition: Composition,
    audio: RenderedAudio,
    onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
    const notes = timeline(composition).filter(({ duration }) => duration > 0);
    const longest = Math.max(0, ...notes.map(({ duration }) => duration));
    const { low, high } = pitchRange(notes);
    const row = (HEIGHT - 2 * MARGIN) / (high - low + 1);
    /** A star's glow, and how thick its tail starts */
    const radius = Math.max(8, Math.min(30, row * 1.4));
    const tail = Math.max(2, Math.min(10, row * 0.45));
    const colors = composition.parts.map((_, p) => partColor(p));
    const glows = colors.map(glowSprite);
    const sparkles = colors.map(sparkleSprite);

    /** Where on the frame a moment is drawn, at a time */
    const xAt = (moment: number, seconds: number) => NOW_X + warp(moment - seconds, CENTER_SPEED, REACH);
    const yOf = (pitch: number) => MARGIN + (high - pitch + 0.5) * row;
    // How far either side of now the frame shows
    const shown = unwarp(NOW_X, CENTER_SPEED, REACH);

    const sprite = (context: CanvasRenderingContext2D, image: HTMLCanvasElement, x: number, y: number, size: number) =>
        context.drawImage(image, x - size / 2, y - size / 2, size, size);

    const draw = (context: CanvasRenderingContext2D, seconds: number) => {
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1;
        context.fillStyle = '#000';
        context.fillRect(0, 0, WIDTH, HEIGHT);

        // A faint line where the music sounds
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fillRect(NOW_X - 1, 0, 2, HEIGHT);

        // Light adds up where stars overlap, as it would
        context.globalCompositeOperation = 'lighter';
        for (const note of notesBetween(notes, seconds - shown, seconds + shown, longest)) {
            const color = colors[note.part] ?? [255, 255, 255];
            const start = xAt(note.start, seconds);
            const end = xAt(note.start + note.duration, seconds);
            const y = yOf(note.pitch);
            const sounding = note.start <= seconds && seconds < note.start + note.duration;
            // Quieter notes are a little dimmer; played ones fade back
            const loudness = 0.55 + 0.45 * (note.velocity / 127);
            const brightness = (sounding ? 1 : note.start > seconds ? 0.75 : 0.3) * loudness;

            // The tail, tapering from the star to where the note ends
            const gradient = context.createLinearGradient(start, 0, end, 0);
            gradient.addColorStop(0, rgba(color, 0.6 * brightness));
            gradient.addColorStop(1, rgba(color, 0.1 * brightness));
            context.globalAlpha = 1;
            context.fillStyle = gradient;
            context.beginPath();
            context.moveTo(start, y - tail / 2);
            context.lineTo(end, y - tail / 8);
            context.lineTo(end, y + tail / 8);
            context.lineTo(start, y + tail / 2);
            context.closePath();
            context.fill();

            const glow = glows[note.part];
            const sparkle = sparkles[note.part];
            if (!glow || !sparkle) continue;
            context.globalAlpha = brightness;
            sprite(context, glow, start, y, radius * 2);

            if (sounding) {
                // A star where it sounds, flaring as the note starts and settling while it holds
                const flare = Math.exp(-(seconds - note.start) / FLARE_SECONDS);
                const size = radius * (2.4 + 2.6 * flare) * loudness;
                context.globalAlpha = Math.min(1, 0.7 + 0.3 * flare);
                sprite(context, glow, NOW_X, y, size);
                sprite(context, sparkle, NOW_X, y, size * 1.6);
            }
        }

        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1;
        fadeEdges(context);
        drawIntro(context, composition, seconds);
    };

    return encodeVideo(audio, draw, onProgress);
}
