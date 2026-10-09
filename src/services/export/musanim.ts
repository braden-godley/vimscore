/**
 * The layout behind `:export musanim`, after the Music Animation Machine: every note a bar of
 * light, its height the pitch and its length the time it sounds, each part in its own color.
 * Drawing is the renderer's; this decides what goes where.
 */

import { TimedNote } from '../timeline/timeline';

export type Rgb = [number, number, number];

/** Bright, well apart from each other on black; parts past these get hues spread around the wheel */
const PALETTE: Rgb[] = [
    [255, 77, 77],
    [77, 166, 255],
    [94, 227, 106],
    [255, 210, 63],
    [199, 125, 255],
    [255, 159, 64],
    [64, 224, 208],
    [255, 111, 181],
];

/** HSL at full saturation and 60% lightness, as RGB */
function hue(degrees: number): Rgb {
    const channel = (n: number) => {
        const k = (n + degrees / 30) % 12;
        return Math.round(255 * (0.6 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [channel(0), channel(8), channel(4)];
}

export function partColor(part: number): Rgb {
    // The golden angle keeps each new hue far from the ones before it
    return PALETTE[part] ?? hue((part * 137.508) % 360);
}

/** Mixes a color toward white, by 0 (unchanged) to 1 (white) */
export const lighten = ([r, g, b]: Rgb, amount: number): Rgb => [
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
];

/**
 * The pitches the picture spans, lowest to highest, with a little room at each edge. A narrow
 * range is widened around its middle, so a few notes don't become huge blocks.
 */
export function pitchRange(notes: TimedNote[], minSpan = 24, padding = 2): { low: number; high: number } {
    if (notes.length === 0) return { low: 60 - minSpan / 2, high: 60 + minSpan / 2 };
    let low = Math.min(...notes.map(({ pitch }) => pitch)) - padding;
    let high = Math.max(...notes.map(({ pitch }) => pitch)) + padding;
    const short = minSpan - (high - low);
    if (short > 0) {
        low -= Math.floor(short / 2);
        high += Math.ceil(short / 2);
    }
    return { low, high };
}

/**
 * The rows of the drum band, one for each drum sound the drum parts play: which row each note
 * number is drawn on, counting down from the top, with the lowest number (the kick, usually)
 * at the bottom. A kit's note numbers name drums rather than pitches, so they get evenly
 * spaced rows of their own instead of places on the pitch scale.
 */
export function drumRows(notes: TimedNote[]): Map<number, number> {
    const sounds = [...new Set(notes.map(({ pitch }) => pitch))].sort((a, b) => b - a);
    return new Map(sounds.map((pitch, row) => [pitch, row]));
}

/**
 * The colors the music is drawn in: each pitched part its own, in order, then each drum sound
 * its own after them, from the kick up, so every kind of hit stands apart from the others and
 * from the pitched parts. `drumParts` says which parts are drums; their own entries are unused.
 */
export function musanimColors(
    drumParts: boolean[],
    drumRow: Map<number, number>,
): { parts: Rgb[]; drums: Map<number, Rgb> } {
    let next = 0;
    const parts = drumParts.map((drums) => (drums ? ([255, 255, 255] as Rgb) : partColor(next++)));
    const sounds = [...drumRow.keys()].sort((a, b) => a - b);
    const drums = new Map(sounds.map((pitch): [number, Rgb] => [pitch, partColor(next++)]));
    return { parts, drums };
}

/**
 * The notes sounding at any time between `from` and `to`, from notes sorted by start (as the
 * timeline gives them). `longest` is the longest note's duration, so the search can start
 * where nothing before could still be sounding.
 */
export function notesBetween(notes: TimedNote[], from: number, to: number, longest: number): TimedNote[] {
    // The first note that could reach `from`
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (notes[mid]!.start < from - longest) lo = mid + 1;
        else hi = mid;
    }
    const found: TimedNote[] = [];
    for (let i = lo; i < notes.length && notes[i]!.start < to; i++) {
        const note = notes[i]!;
        if (note.start + note.duration > from) found.push(note);
    }
    return found;
}

/**
 * How far from the middle of the frame a moment `ahead` seconds from now is drawn: fastest
 * through the middle, at `speed` pixels a second, and slowing toward the edges, so notes rush
 * in to sound and drift away after. It never quite reaches `reach` pixels, however far off.
 */
export function warp(ahead: number, speed: number, reach: number): number {
    const settle = reach / speed;
    return Math.sign(ahead) * reach * (1 - Math.exp(-Math.abs(ahead) / settle));
}

/** How many seconds from now are drawn `distance` pixels from the middle; `warp` undone */
export function unwarp(distance: number, speed: number, reach: number): number {
    const settle = reach / speed;
    return -Math.sign(distance) * settle * Math.log(1 - Math.min(Math.abs(distance), reach * 0.9999) / reach);
}
