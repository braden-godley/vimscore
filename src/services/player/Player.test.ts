import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Instrument } from '../instrument/Instrument';
import { Synth } from '../synth/Synth';
import { ARPEGGIO_STEP } from '../timeline/timeline';
import { Player } from './Player';

/** Just enough of an AudioContext for the scheduler: a clock that stands still at zero */
const ctx = { currentTime: 0, resume: async () => {} } as unknown as AudioContext;

/** A synth that writes down what it's asked to do */
function recordingSynth() {
    const played: { part: number; pitch: number; when: number; duration: number }[] = [];
    const record = {
        played,
        instruments: [] as Instrument[],
        auditions: [] as { instrument: Instrument; pitch: number }[],
        stops: 0,
    };
    const synth: Synth = {
        setInstruments: (instruments) => {
            record.instruments = instruments;
        },
        setMix: () => {},
        playNote: (part, pitch, when, duration) => played.push({ part, pitch, when, duration }),
        audition: (instrument, pitch) => record.auditions.push({ instrument, pitch }),
        stopAll: () => {
            record.stops++;
        },
    };
    return { synth, record };
}

function playFrom(from: number) {
    const { synth, record } = recordingSynth();
    const { played } = record;
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
    it("sounds the pitches together right away on the part's instrument, cutting off the last preview", () => {
        const { synth, record } = recordingSynth();
        const player = new Player(ctx, synth);
        player.preview([60, 64], 1);
        expect(record.played).toEqual([
            { part: 1, pitch: 60, when: 0, duration: 0.35 },
            { part: 1, pitch: 64, when: 0, duration: 0.35 },
        ]);
        expect(record.stops).toBe(1);
    });

    it('rolls them up from the bottom when asked', () => {
        const { synth, record } = recordingSynth();
        new Player(ctx, synth).preview([67, 60, 64], 0, true);
        expect(record.played.map(({ pitch, when }) => [pitch, when])).toEqual([
            [60, 0],
            [64, ARPEGGIO_STEP],
            [67, 2 * ARPEGGIO_STEP],
        ]);
    });
});

describe('Player.setComposition', () => {
    it('tells the synth what each part plays, and plays notes on their part', () => {
        const { synth, record } = recordingSynth();
        const player = new Player(ctx, synth);
        const withViolin = {
            ...exampleComposition,
            parts: exampleComposition.parts.map((part, i) => (i === 0 ? { ...part, program: 40 } : part)),
        };
        player.setComposition(withViolin);
        expect(record.instruments.map(({ name, program }) => [name, program])).toEqual([
            ['Violin', 40],
            ['Acoustic Grand Piano', 0],
        ]);
        player.play(2);
        expect(record.played.map(({ part, pitch }) => [part, pitch]).sort()).toEqual([
            [0, 76],
            [1, 43],
        ]);
    });
});

describe('Player.audition', () => {
    it('plays a note on any instrument', () => {
        const { synth, record } = recordingSynth();
        new Player(ctx, synth).audition({ name: 'Cello', program: 42, bank: 0, drums: false }, 60);
        expect(record.auditions).toEqual([{ instrument: expect.objectContaining({ program: 42 }), pitch: 60 }]);
    });
});
