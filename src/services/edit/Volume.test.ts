import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { readScore, writeScore } from '../file/ScoreFile';
import { fraction } from '../fraction/Fraction';
import { timeline } from '../timeline/timeline';
import { setTimeSignature } from './MeasureChanges';
import { setVolume } from './Volume';

/** Each melody note's pitch and volume, in order */
const melodyVolumes = (composition: typeof exampleComposition) =>
    timeline(composition)
        .filter(({ part }) => part === 0)
        .map(({ pitch, volume }) => [pitch, volume]);

describe('setVolume', () => {
    it('marks a part, replacing a marking at the same moment, in time order', () => {
        const marked = setVolume(setVolume(exampleComposition, 0, 0, fraction(1, 2), 30), 0, 0, fraction(1, 4), 60);
        expect(marked.parts[0]!.measures[0]!.volumes).toEqual([
            { offset: fraction(1, 4), percent: 60 },
            { offset: fraction(1, 2), percent: 30 },
        ]);
        expect(setVolume(marked, 0, 0, fraction(1, 2), 90).parts[0]!.measures[0]!.volumes?.[1]?.percent).toBe(90);
        expect(marked.parts[1]).toBe(exampleComposition.parts[1]);
    });
});

describe('volume in playback', () => {
    it('plays at 80% until a marking, then at its volume until the next', () => {
        const marked = setVolume(setVolume(exampleComposition, 0, 0, fraction(1, 4), 10), 0, 1, fraction(0), 100);
        const volumes = melodyVolumes(marked).map(([, volume]) => volume);
        // First chord at 80%, the second and third at 10%, then measure 2 at 100%
        expect(volumes.slice(0, 9)).toEqual([0.8, 0.8, 0.8, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
        expect(volumes[9]).toBe(1);
        // Only that part
        expect(timeline(marked).filter(({ part }) => part === 1).every(({ volume }) => volume === 0.8)).toBe(true);
    });
});

describe('volume markings in the file and through re-barring', () => {
    it('round-trip', () => {
        const marked = setVolume(exampleComposition, 1, 2, fraction(3, 8), 45);
        expect(readScore(writeScore(marked))).toEqual(marked);
        expect(writeScore(marked)).toContain('{ "at": "3/8", "percent": 45 }');
    });

    it('stay with the music when measures are re-barred', () => {
        // Beat 4 of the 4/4 measure is beat 1 of the second 3/4 measure
        const marked = setVolume(exampleComposition, 0, 0, fraction(3, 4), 20);
        const changed = setTimeSignature(marked, 0, { beats: 3, beatValue: 4 });
        expect(changed.parts[0]!.measures[1]!.volumes).toEqual([{ offset: fraction(0), percent: 20 }]);
        expect(melodyVolumes(changed)).toEqual(melodyVolumes(marked));
    });
});
