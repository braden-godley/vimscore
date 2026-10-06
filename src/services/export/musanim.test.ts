import { describe, expect, it } from 'vitest';
import { TimedNote } from '../timeline/timeline';
import { lighten, notesBetween, partColor, pitchRange, unwarp, warp } from './musanim';

const note = (pitch: number, start: number, duration: number): TimedNote => ({ part: 0, pitch, start, duration, volume: 1 });

describe('partColor', () => {
    it('gives every part its own color, even past the palette', () => {
        const colors = Array.from({ length: 16 }, (_, p) => partColor(p).join());
        expect(new Set(colors).size).toBe(16);
        const channels = colors.flatMap((color) => color.split(',').map(Number));
        expect(channels.every((channel) => channel >= 0 && channel <= 255)).toBe(true);
    });

    it('lightens toward white', () => {
        expect(lighten([255, 0, 100], 0.5)).toEqual([255, 127.5, 177.5]);
        expect(lighten([10, 20, 30], 1)).toEqual([255, 255, 255]);
    });
});

describe('pitchRange', () => {
    it('spans the notes with room at the edges', () => {
        expect(pitchRange([note(30, 0, 1), note(90, 1, 1)])).toEqual({ low: 28, high: 92 });
    });

    it('widens a narrow range around its middle', () => {
        expect(pitchRange([note(60, 0, 1), note(64, 1, 1)])).toEqual({ low: 50, high: 74 });
    });

    it('has somewhere to be with no notes', () => {
        expect(pitchRange([])).toEqual({ low: 48, high: 72 });
    });
});

describe('notesBetween', () => {
    const notes = [note(60, 0, 4), note(62, 1, 1), note(64, 2, 1), note(65, 5, 1), note(67, 9, 1)];

    it('finds every note sounding in the window, including long ones that began before it', () => {
        expect(notesBetween(notes, 3, 6, 4).map(({ pitch }) => pitch)).toEqual([60, 65]);
        expect(notesBetween(notes, 2.5, 6, 4).map(({ pitch }) => pitch)).toEqual([60, 64, 65]);
    });

    it('leaves out notes that end as it starts, or start as it ends', () => {
        expect(notesBetween(notes, 6, 9, 4)).toEqual([]);
    });
});

describe('warp', () => {
    it('moves fastest through the middle and slows toward the edges', () => {
        const step = (at: number) => warp(at + 0.01, 500, 1000) - warp(at, 500, 1000);
        expect(step(0) / 0.01).toBeCloseTo(500, -1);
        expect(step(1)).toBeLessThan(step(0));
        expect(step(3)).toBeLessThan(step(1));
        expect(step(-1)).toBeLessThan(step(-0.01));
    });

    it('keeps the past on the left and the future on the right, within reach', () => {
        expect(warp(0, 500, 1000)).toBe(0);
        expect(warp(-2, 500, 1000)).toBe(-warp(2, 500, 1000));
        expect(warp(100, 500, 1000)).toBeLessThanOrEqual(1000);
    });

    it('is undone by unwarp', () => {
        for (const seconds of [-3, -0.5, 0, 0.25, 4]) {
            expect(unwarp(warp(seconds, 500, 1000), 500, 1000)).toBeCloseTo(seconds, 6);
        }
    });
});
