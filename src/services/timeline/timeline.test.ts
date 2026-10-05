import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { Duration } from '../duration/Duration';
import { Event } from '../event/Event';
import { Note } from '../note/Note';
import { TimedNote, timeline } from './timeline';

const quarter: Duration = { base: 4, dots: 0 };
const eighth: Duration = { base: 8, dots: 0 };

const chord = (duration: Duration, ...notes: Note[]): Event => ({ kind: 'chord', duration, notes });

/** A 4/4 composition at quarter = 60, so a quarter note lasts one second */
function compose(...measures: Event[][][]): Composition {
    return {
        title: 'Test',
        measures: measures.map((_, i) => (i === 0 ? { tempo: { bpm: 60, beat: quarter } } : {})),
        parts: [{ name: 'Test', program: 0, measures: measures.map((voices) => ({ voices: voices.map((events) => ({ events })) })) }],
        soundfont: { filePath: '' },
    };
}

function rounded(notes: TimedNote[]) {
    return notes.map(({ pitch, start, duration }) => ({
        pitch,
        start: Number(start.toFixed(6)),
        duration: Number(duration.toFixed(6)),
    }));
}

describe('timeline', () => {
    it('places notes back to back after rests', () => {
        const notes = timeline(compose([[chord(quarter, { pitch: 60 }), { kind: 'rest', duration: quarter }, chord(quarter, { pitch: 62 })]]));
        expect(notes).toEqual([
            { pitch: 60, start: 0, duration: 1 },
            { pitch: 62, start: 2, duration: 1 },
        ]);
    });

    it('times triplets exactly', () => {
        const triplet: Event = {
            kind: 'tuplet',
            actual: 3,
            normal: 2,
            events: [60, 62, 64].map((pitch) => chord(eighth, { pitch })),
        };
        expect(rounded(timeline(compose([[triplet, chord(quarter, { pitch: 65 })]])))).toEqual([
            { pitch: 60, start: 0, duration: 0.333333 },
            { pitch: 62, start: 0.333333, duration: 0.333333 },
            { pitch: 64, start: 0.666667, duration: 0.333333 },
            { pitch: 65, start: 1, duration: 1 },
        ]);
    });

    it('merges ties across barlines, but only into the next chord of the same voice', () => {
        const rest: Event = { kind: 'rest', duration: { base: 2, dots: 1 } };
        const notes = timeline(
            compose(
                [
                    [rest, chord(quarter, { pitch: 60, tie: true }, { pitch: 64, tie: true })],
                    [chord(quarter, { pitch: 67 })],
                ],
                [
                    // 60 continues; 64 isn't in the next chord, so its tie is dropped
                    [chord(quarter, { pitch: 60 }), chord(quarter, { pitch: 64 })],
                    // Same pitch, but a different voice
                    [chord(quarter, { pitch: 64 })],
                ],
            ),
        );
        expect(notes).toEqual([
            { pitch: 67, start: 0, duration: 1 },
            { pitch: 60, start: 3, duration: 2 },
            { pitch: 64, start: 3, duration: 1 },
            { pitch: 64, start: 4, duration: 1 },
            { pitch: 64, start: 5, duration: 1 },
        ]);
    });

    it('shortens staccato notes', () => {
        expect(timeline(compose([[chord(quarter, { pitch: 60, staccato: true })]]))).toEqual([
            { pitch: 60, start: 0, duration: 0.5 },
        ]);
    });

    it('follows time signature and tempo changes in the example', () => {
        const notes = timeline(exampleComposition);
        // 4/4 at quarter = 120 lasts 2s, then 3/4 lasts 1.5s, so the 6/8 bass note starts at 3.5s
        // and lasts a measure at dotted quarter = 60
        const lastBass = notes.filter((note) => note.pitch === 48).at(-1);
        expect(lastBass?.start).toBe(3.5);
        expect(lastBass?.duration).toBeCloseTo(2);
        // The tied C sounds for three eighths plus one
        expect(notes.find((note) => note.pitch === 72 && note.start === 3.5)?.duration).toBeCloseTo(4 / 3);
    });
});
