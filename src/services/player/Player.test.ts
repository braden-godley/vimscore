import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Synth } from '../synth/Synth';
import { Player } from './Player';

/** Just enough of an AudioContext for the scheduler: a clock that stands still at zero */
const ctx = { currentTime: 0, resume: async () => {} } as unknown as AudioContext;

function playFrom(from: number) {
    const played: { pitch: number; when: number; duration: number }[] = [];
    const synth: Synth = {
        playNote: (pitch, when, duration) => played.push({ pitch, when, duration }),
        stopAll: () => {},
    };
    const player = new Player(ctx, synth);
    player.setComposition(exampleComposition);
    player.play(from);
    const position = player.position;
    player.stop();
    return { played, position };
}

// Measure 2 starts at 2s with the melody's triplet E and the bass's G, held for 1.5s
describe('Player.play', () => {
    it('starts at the given time, after the start delay', () => {
        const { played, position } = playFrom(2);
        expect(played.map(({ pitch }) => pitch).sort()).toEqual([43, 76]);
        for (const { when } of played) expect(when).toBeCloseTo(0.05);
        expect(position).toBe(2);
    });

    it('plays what is left of notes already sounding', () => {
        const { played } = playFrom(2.5);
        const bass = played.find(({ pitch }) => pitch === 43);
        expect(bass?.when).toBeCloseTo(0.05);
        expect(bass?.duration).toBeCloseTo(1);
    });
});

describe('Player.preview', () => {
    it('sounds the pitches together right away, cutting off the last preview', () => {
        const played: number[] = [];
        let stops = 0;
        const synth: Synth = { playNote: (pitch, when) => played.push(when === 0 ? pitch : -1), stopAll: () => stops++ };
        const player = new Player(ctx, synth);
        player.preview([60, 64]);
        expect(played).toEqual([60, 64]);
        expect(stops).toBe(1);
    });
});
