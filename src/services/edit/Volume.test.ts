import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { readScore, writeScore } from '../file/ScoreFile';
import { fraction } from '../fraction/Fraction';
import { timeline } from '../timeline/timeline';
import { setTimeSignature } from './MeasureChanges';
import { setVolume, toggleHairpin } from './Volume';

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

describe('toggleHairpin', () => {
    it('adds a hairpin, replaces one starting at the same moment, and takes the same one off', () => {
        const added = toggleHairpin(exampleComposition, 0, 0, fraction(1, 4), fraction(1, 2), 'crescendo');
        expect(added.parts[0]!.measures[0]!.hairpins).toEqual([
            { offset: fraction(1, 4), length: fraction(1, 2), kind: 'crescendo' },
        ]);
        const replaced = toggleHairpin(added, 0, 0, fraction(1, 4), fraction(1, 2), 'diminuendo');
        expect(replaced.parts[0]!.measures[0]!.hairpins?.map(({ kind }) => kind)).toEqual(['diminuendo']);
        const removed = toggleHairpin(replaced, 0, 0, fraction(1, 4), fraction(1, 2), 'diminuendo');
        expect(removed.parts[0]!.measures[0]).toEqual(exampleComposition.parts[0]!.measures[0]);
        expect(added.parts[1]).toBe(exampleComposition.parts[1]);
    });
});

describe('hairpins in playback', () => {
    /** Each melody chord's volume, one per chord, for the first two measures' first notes */
    const chordVolumes = (composition: typeof exampleComposition) => {
        const notes = timeline(composition).filter(({ part }) => part === 0);
        return [...new Map(notes.map(({ start, volume }) => [start, volume])).values()];
    };

    it('ramps to the volume marking at its end', () => {
        const marked = setVolume(
            toggleHairpin(exampleComposition, 0, 0, fraction(0), fraction(1), 'crescendo'),
            0,
            1,
            fraction(0),
            100,
        );
        // A quarter of the way, then half, then the marking
        expect(chordVolumes(marked).slice(0, 4)).toEqual([0.8, 0.85, 0.9, 1]);
    });

    it('goes 20 louder or softer with nothing to aim for, and stays there', () => {
        const marked = toggleHairpin(exampleComposition, 0, 0, fraction(1, 4), fraction(1, 2), 'diminuendo');
        expect(chordVolumes(marked).slice(0, 4)).toEqual([0.8, 0.8, 0.7, 0.6]);
        expect(chordVolumes(marked).at(-1)).toBe(0.6);
    });

    it('goes to its own volume when it has one, and a marking inside it cuts it short', () => {
        const hairpin = toggleHairpin(exampleComposition, 0, 0, fraction(0), fraction(1), 'diminuendo');
        const aimed = {
            ...hairpin,
            parts: hairpin.parts.map((part, p) =>
                p !== 0
                    ? part
                    : {
                          ...part,
                          measures: part.measures.map((m, i) =>
                              i === 0 ? { ...m, hairpins: m.hairpins!.map((h) => ({ ...h, percent: 40 })) } : m,
                          ),
                      },
            ),
        };
        expect(chordVolumes(aimed).slice(0, 4)).toEqual([0.8, 0.7, 0.6, 0.4]);
        expect(chordVolumes(setVolume(aimed, 0, 0, fraction(1, 2), 90)).slice(0, 4)).toEqual([0.8, 0.7, 0.9, 0.9]);
    });
});

describe('hairpins in the file and through re-barring', () => {
    it('round-trip', () => {
        const marked = toggleHairpin(exampleComposition, 1, 0, fraction(1, 2), fraction(3, 2), 'diminuendo');
        expect(readScore(writeScore(marked))).toEqual(marked);
        expect(writeScore(marked)).toContain('{ "at": "1/2", "length": "3/2", "kind": "diminuendo" }');
    });

    it('stay with the music when measures are re-barred, keeping their length', () => {
        // Beat 4 to the end of the 4/4 measure is the first beat of the second 3/4 measure
        const marked = toggleHairpin(exampleComposition, 0, 0, fraction(3, 4), fraction(1, 4), 'crescendo');
        const changed = setTimeSignature(marked, 0, { beats: 3, beatValue: 4 });
        expect(changed.parts[0]!.measures[1]!.hairpins).toEqual([
            { offset: fraction(0), length: fraction(1, 4), kind: 'crescendo' },
        ]);
        expect(melodyVolumes(changed)).toEqual(melodyVolumes(marked));
    });
});
