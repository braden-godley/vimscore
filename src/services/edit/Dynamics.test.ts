import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { readScore, writeScore } from '../file/ScoreFile';
import { fraction } from '../fraction/Fraction';
import { timeline } from '../timeline/timeline';
import { setTimeSignature } from './MeasureChanges';
import { dynamicBefore, setDynamic, stepDynamicAt, toggleHairpin } from './Dynamics';

/** Each melody note's pitch and velocity, in order */
const melodyVelocities = (composition: typeof exampleComposition) =>
    timeline(composition)
        .filter(({ part }) => part === 0)
        .map(({ pitch, velocity }) => [pitch, velocity]);

describe('setDynamic', () => {
    it('marks a part, replacing a marking at the same moment, in time order', () => {
        const marked = setDynamic(setDynamic(exampleComposition, 0, 0, fraction(1, 2), 'pp'), 0, 0, fraction(1, 4), 'f');
        expect(marked.parts[0]!.measures[0]!.dynamics).toEqual([
            { offset: fraction(1, 4), dynamic: 'f' },
            { offset: fraction(1, 2), dynamic: 'pp' },
        ]);
        expect(setDynamic(marked, 0, 0, fraction(1, 2), 'ff').parts[0]!.measures[0]!.dynamics?.[1]?.dynamic).toBe('ff');
        expect(marked.parts[1]).toBe(exampleComposition.parts[1]);
    });

    it('takes a marking off without a dynamic', () => {
        const marked = setDynamic(exampleComposition, 0, 0, fraction(1, 2), 'pp');
        expect(setDynamic(marked, 0, 0, fraction(1, 2), undefined).parts[0]!.measures[0]).toEqual(
            exampleComposition.parts[0]!.measures[0],
        );
    });
});

describe('dynamicBefore', () => {
    it('is the last marking before the moment, in earlier measures too, or mf', () => {
        const marked = setDynamic(setDynamic(exampleComposition, 0, 0, fraction(1, 4), 'p'), 0, 1, fraction(1, 2), 'f');
        expect(dynamicBefore(marked, 0, 0, fraction(1, 4))).toBe('mf');
        expect(dynamicBefore(marked, 0, 0, fraction(1, 2))).toBe('p');
        expect(dynamicBefore(marked, 0, 1, fraction(1, 2))).toBe('p');
        expect(dynamicBefore(marked, 0, 2, fraction(0))).toBe('f');
        expect(dynamicBefore(marked, 1, 2, fraction(0))).toBe('mf');
    });
});

describe('stepDynamicAt', () => {
    const at = (composition: typeof exampleComposition) => composition.parts[0]!.measures[0]!.dynamics;

    it('marks the next dynamic louder or softer than the one in effect, a count of steps', () => {
        expect(at(stepDynamicAt(exampleComposition, 0, 0, fraction(1, 4), 1))).toEqual([
            { offset: fraction(1, 4), dynamic: 'f' },
        ]);
        expect(at(stepDynamicAt(exampleComposition, 0, 0, fraction(1, 4), -3))).toEqual([
            { offset: fraction(1, 4), dynamic: 'pp' },
        ]);
    });

    it('steps a marking already there', () => {
        const marked = setDynamic(exampleComposition, 0, 0, fraction(1, 4), 'p');
        expect(at(stepDynamicAt(marked, 0, 0, fraction(1, 4), 1))).toEqual([{ offset: fraction(1, 4), dynamic: 'mp' }]);
    });

    it('stops at ppp and ff', () => {
        const loudest = setDynamic(exampleComposition, 0, 0, fraction(1, 4), 'ff');
        expect(stepDynamicAt(loudest, 0, 0, fraction(1, 4), 1)).toBe(loudest);
        expect(at(stepDynamicAt(exampleComposition, 0, 0, fraction(1, 4), -9))).toEqual([
            { offset: fraction(1, 4), dynamic: 'ppp' },
        ]);
        expect(stepDynamicAt(exampleComposition, 0, 0, fraction(0), 0)).toBe(exampleComposition);
    });

    it('takes a marking off when it comes back to the dynamic already in effect', () => {
        const marked = setDynamic(exampleComposition, 0, 0, fraction(0), 'p');
        const louder = stepDynamicAt(marked, 0, 1, fraction(0), 1);
        expect(louder.parts[0]!.measures[1]!.dynamics).toEqual([{ offset: fraction(0), dynamic: 'mp' }]);
        expect(stepDynamicAt(louder, 0, 1, fraction(0), -1)).toEqual(marked);
        expect(stepDynamicAt(stepDynamicAt(exampleComposition, 0, 0, fraction(0), 1), 0, 0, fraction(0), -1)).toEqual(
            exampleComposition,
        );
    });
});

describe('dynamics in playback', () => {
    it('plays at mf until a marking, then at its velocity until the next', () => {
        const marked = setDynamic(setDynamic(exampleComposition, 0, 0, fraction(1, 4), 'ppp'), 0, 1, fraction(0), 'ff');
        const velocities = melodyVelocities(marked).map(([, velocity]) => velocity);
        // First chord at mf, the second and third at ppp, then measure 2 at ff
        expect(velocities.slice(0, 9)).toEqual([88, 88, 88, 10, 10, 10, 10, 10, 10]);
        expect(velocities[9]).toBe(127);
        // Only that part
        expect(timeline(marked).filter(({ part }) => part === 1).every(({ velocity }) => velocity === 88)).toBe(true);
    });
});

describe('dynamics in the file and through re-barring', () => {
    it('round-trip', () => {
        const marked = setDynamic(exampleComposition, 1, 2, fraction(3, 8), 'p');
        expect(readScore(writeScore(marked))).toEqual(marked);
        expect(writeScore(marked)).toContain('{ "at": "3/8", "mark": "p" }');
    });

    it('read volumes in percent from version 2 files as the nearest dynamic', () => {
        const file = JSON.parse(writeScore(exampleComposition));
        file.version = 2;
        file.parts[0].measures[0].volume = [{ at: '1/4', percent: 60 }];
        file.parts[0].measures[0].hairpin = [{ at: '1/4', length: '1/2', kind: 'crescendo', percent: 100 }];
        const read = (readScore(JSON.stringify(file)) as typeof exampleComposition).parts[0]!.measures[0]!;
        expect(read.dynamics).toEqual([{ offset: fraction(1, 4), dynamic: 'mp' }]);
        expect(read.hairpins?.[0]?.dynamic).toBe('ff');
    });

    it('stay with the music when measures are re-barred', () => {
        // Beat 4 of the 4/4 measure is beat 1 of the second 3/4 measure
        const marked = setDynamic(exampleComposition, 0, 0, fraction(3, 4), 'pp');
        const changed = setTimeSignature(marked, 0, { beats: 3, beatValue: 4 });
        expect(changed.parts[0]!.measures[1]!.dynamics).toEqual([{ offset: fraction(0), dynamic: 'pp' }]);
        expect(melodyVelocities(changed)).toEqual(melodyVelocities(marked));
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
    /** Each melody chord's velocity, one per chord */
    const chordVelocities = (composition: typeof exampleComposition) => {
        const notes = timeline(composition).filter(({ part }) => part === 0);
        return [...new Map(notes.map(({ start, velocity }) => [start, velocity])).values()];
    };

    it('ramps to the dynamic marked at its end', () => {
        const marked = setDynamic(
            toggleHairpin(exampleComposition, 0, 0, fraction(0), fraction(1), 'crescendo'),
            0,
            1,
            fraction(0),
            'ff',
        );
        // A quarter of the way from mf to ff, then half, then the marking
        expect(chordVelocities(marked).slice(0, 4)).toEqual([88, 98, 108, 127]);
    });

    it('goes one dynamic louder or softer with nothing to aim for, and stays there', () => {
        const marked = toggleHairpin(exampleComposition, 0, 0, fraction(1, 4), fraction(1, 2), 'diminuendo');
        // From mf toward mp
        expect(chordVelocities(marked).slice(0, 4)).toEqual([88, 88, 78, 69]);
        expect(chordVelocities(marked).at(-1)).toBe(69);
    });

    it('goes to its own dynamic when it has one, and a marking inside it cuts it short', () => {
        const hairpin = toggleHairpin(exampleComposition, 0, 0, fraction(0), fraction(1), 'diminuendo');
        const aimed = {
            ...hairpin,
            parts: hairpin.parts.map((part, p) =>
                p !== 0
                    ? part
                    : {
                          ...part,
                          measures: part.measures.map((m, i) =>
                              i === 0 ? { ...m, hairpins: m.hairpins!.map((h) => ({ ...h, dynamic: 'p' as const })) } : m,
                          ),
                      },
            ),
        };
        expect(chordVelocities(aimed).slice(0, 4)).toEqual([88, 78, 69, 49]);
        expect(chordVelocities(setDynamic(aimed, 0, 0, fraction(1, 2), 'f')).slice(0, 4)).toEqual([88, 78, 108, 108]);
        expect(readScore(writeScore(aimed))).toEqual(aimed);
        expect(writeScore(aimed)).toContain('"kind": "diminuendo", "to": "p"');
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
        expect(melodyVelocities(changed)).toEqual(melodyVelocities(marked));
    });
});
