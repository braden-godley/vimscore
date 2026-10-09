import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { START, cursorSeconds } from '../cursor/Cursor';
import { toggleRepeat } from '../edit/Repeats';
import { setTimeSignature } from '../edit/MeasureChanges';
import { readScore, writeScore } from '../file/ScoreFile';
import { MeasureInfo } from '../measure/Measure';
import {
    PlayedMeasure,
    clockTime,
    nextPlayedMeasure,
    performance,
    performanceOrder,
    performanceSeconds,
    playedMeasureAt,
} from './performance';
import { timeline } from './timeline';

const bars = (count: number, marks: Record<number, MeasureInfo> = {}): MeasureInfo[] =>
    Array.from({ length: count }, (_, i) => marks[i] ?? {});

describe('performanceOrder', () => {
    it('plays straight through without repeats', () => {
        expect(performanceOrder(bars(3))).toEqual([0, 1, 2]);
    });

    it('plays a section twice, then goes on', () => {
        expect(performanceOrder(bars(4, { 1: { repeatStart: true }, 2: { repeatEnd: true } }))).toEqual([0, 1, 2, 1, 2, 3]);
    });

    it('plays each measure once when skipping repeats', () => {
        const marks = { 1: { repeatStart: true }, 2: { repeatEnd: true } };
        expect(performanceOrder(bars(4, marks), { skipRepeats: true })).toEqual([0, 1, 2, 3]);
    });

    it('goes back to the beginning, or after the last repeat, without a start', () => {
        expect(performanceOrder(bars(4, { 1: { repeatEnd: true }, 3: { repeatEnd: true } }))).toEqual([
            0, 1, 0, 1, 2, 3, 2, 3,
        ]);
    });

    it('repeats a measure that both starts and ends a section', () => {
        expect(performanceOrder(bars(3, { 1: { repeatStart: true, repeatEnd: true } }))).toEqual([0, 1, 1, 2]);
    });
});

describe('nextPlayedMeasure', () => {
    // Measures 1 and 2 repeated: 0, 1, 2, 1, 2, 3
    const played: PlayedMeasure[] = [0, 1, 2, 1, 2, 3].map((measure, i) => ({ measure, startSeconds: i, seconds: 1 }));
    const next = (index: number) => played.indexOf(nextPlayedMeasure(played, index)!);

    it('goes on to the next measure', () => {
        expect(next(0)).toBe(1);
        expect(next(1)).toBe(2);
    });

    it('jumps over the repeat from its end', () => {
        expect(next(2)).toBe(5);
    });

    it('stops at the last measure', () => {
        expect(nextPlayedMeasure(played, 5)).toBeUndefined();
    });
});

// The example: 4/4 at 2s, 3/4 at 1.5s, 6/8 at 2s
describe('playing repeats', () => {
    const repeated = toggleRepeat(exampleComposition, 0, 'end');

    it('times each measure as played', () => {
        expect(performance(repeated).map(({ measure, startSeconds }) => [measure, startSeconds])).toEqual([
            [0, 0],
            [0, 2],
            [1, 4],
            [2, 5.5],
        ]);
        expect(playedMeasureAt(performance(repeated), 3)?.measure).toBe(0);
        expect(playedMeasureAt(performance(repeated), 4.2)?.measure).toBe(1);
    });

    it('plays the notes again, and doesn’t tie back over the repeat', () => {
        const bass = timeline(repeated).filter(({ part }) => part === 1);
        expect(bass.map(({ pitch, start }) => [pitch, start])).toEqual([
            [48, 0],
            [48, 2],
            [43, 4],
            [48, 5.5],
        ]);
    });

    it('plays from the cursor from the first time its measure plays', () => {
        expect(cursorSeconds(repeated, { ...START, measure: 1 })).toBe(4);
    });
});

describe('repeat marks', () => {
    it('toggle on and off', () => {
        const on = toggleRepeat(exampleComposition, 1, 'start');
        expect(on.measures[1]).toEqual({ timeSignature: { beats: 3, beatValue: 4 }, repeatStart: true });
        expect(toggleRepeat(on, 1, 'start').measures[1]).toEqual(exampleComposition.measures[1]);
    });

    it('are saved', () => {
        const marked = toggleRepeat(toggleRepeat(exampleComposition, 1, 'start'), 2, 'end');
        expect(readScore(writeScore(marked))).toEqual(marked);
    });

    it('stay at the start and end of their music when re-barred', () => {
        // The 4/4 measure becomes 3/4 + 3/4; its end is now in the second
        const marked = toggleRepeat(toggleRepeat(exampleComposition, 0, 'start'), 0, 'end');
        const changed = setTimeSignature(marked, 0, { beats: 3, beatValue: 4 });
        expect(changed.measures[0]).toMatchObject({ repeatStart: true });
        expect(changed.measures[0]?.repeatEnd).toBeUndefined();
        expect(changed.measures[1]).toMatchObject({ repeatEnd: true });
    });
});

describe('performanceSeconds', () => {
    it('runs to the end of the last measure played', () => {
        const played: PlayedMeasure[] = [
            { measure: 0, startSeconds: 0, seconds: 2 },
            { measure: 1, startSeconds: 2, seconds: 3 },
        ];
        expect(performanceSeconds(played)).toBe(5);
        expect(performanceSeconds([])).toBe(0);
    });

    it('counts repeats unless they are skipped', () => {
        const repeated = toggleRepeat(exampleComposition, 0, 'end');
        const once = performanceSeconds(performance(repeated, { skipRepeats: true }));
        expect(performanceSeconds(performance(repeated))).toBeGreaterThan(once);
    });
});

describe('clockTime', () => {
    it('reads minutes and seconds, dropping parts of a second', () => {
        expect(clockTime(0)).toBe('0:00');
        expect(clockTime(30.9)).toBe('0:30');
        expect(clockTime(90)).toBe('1:30');
    });

    it('reads hours past an hour', () => {
        expect(clockTime(3725)).toBe('1:02:05');
    });
});
