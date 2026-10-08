import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { Duration } from '../duration/Duration';
import { Chord, Event } from '../event/Event';
import { Note } from '../note/Note';
import { ARPEGGIO_STEP, MARCATO_LENGTH, NOTE_LENGTH, SLURRED_LENGTH, TimedNote, timeline } from './timeline';
import { spell } from '../pitch/Pitch';

const quarter: Duration = { base: 4, dots: 0 };
const eighth: Duration = { base: 8, dots: 0 };

const chord = (duration: Duration, ...notes: Note[]): Event => ({ kind: 'chord', duration, notes });

/** A 4/4 composition at quarter = 60, so a quarter note lasts one second */
function compose(...measures: Event[][][]): Composition {
    return {
        title: 'Test',
        measures: measures.map((_, i) => (i === 0 ? { tempo: { bpm: 60, beat: quarter } } : {})),
        parts: [{ name: 'Test', program: 0, measures: measures.map((voices) => ({ voices: voices.map((events) => ({ events })) })) }],
        soundfonts: [],
    };
}

const round = (seconds: number) => Number(seconds.toFixed(6));

function rounded(notes: TimedNote[]) {
    return notes.map(({ pitch, start, duration }) => ({ pitch, start: round(start), duration: round(duration) }));
}

const rolled = (duration: Duration, ...notes: Note[]): Chord => ({ kind: 'chord', duration, notes, arpeggio: true });

describe('timeline', () => {
    it('rolls an arpeggio up from the bottom note, every note ending together', () => {
        // Written top first, but still rolled from the bottom
        const notes = timeline(compose([[rolled(quarter, { pitch: spell(67) }, { pitch: spell(60) }, { pitch: spell(64) })]]));
        expect(rounded(notes)).toEqual([
            { pitch: 60, start: 0, duration: NOTE_LENGTH },
            { pitch: 64, start: ARPEGGIO_STEP, duration: round(NOTE_LENGTH - ARPEGGIO_STEP) },
            { pitch: 67, start: 2 * ARPEGGIO_STEP, duration: round(NOTE_LENGTH - 2 * ARPEGGIO_STEP) },
        ]);
    });

    it('squeezes a roll into the first half of a short chord', () => {
        const thirtySecond: Duration = { base: 32, dots: 0 };
        // A 32nd lasts 1/8 second here, so five notes come in 1/64 second apart
        const notes = timeline(compose([[rolled(thirtySecond, ...[60, 64, 67, 72, 76].map((pitch) => ({ pitch: spell(pitch) })))]]));
        expect(notes.at(-1)!.start).toBeCloseTo(1 / 16);
    });

    it("doesn't roll notes tied in from before, which are already sounding", () => {
        const notes = timeline(compose([[chord(quarter, { pitch: spell(60), tie: true }), rolled(quarter, { pitch: spell(60) }, { pitch: spell(64) }, { pitch: spell(67) })]]));
        expect(rounded(notes)).toEqual([
            // A tied note is let go just short of the end of its last chord
            { pitch: 60, start: 0, duration: 1 + NOTE_LENGTH },
            { pitch: 64, start: 1, duration: NOTE_LENGTH },
            { pitch: 67, start: 1 + ARPEGGIO_STEP, duration: round(NOTE_LENGTH - ARPEGGIO_STEP) },
        ]);
    });

    it('places notes back to back after rests', () => {
        const notes = timeline(compose([[chord(quarter, { pitch: spell(60) }), { kind: 'rest', duration: quarter }, chord(quarter, { pitch: spell(62) })]]));
        expect(rounded(notes)).toEqual([
            { pitch: 60, start: 0, duration: NOTE_LENGTH },
            { pitch: 62, start: 2, duration: NOTE_LENGTH },
        ]);
    });

    it('times triplets exactly', () => {
        const triplet: Event = {
            kind: 'tuplet',
            actual: 3,
            normal: 2,
            events: [60, 62, 64].map((pitch) => chord(eighth, { pitch: spell(pitch) })),
        };
        expect(rounded(timeline(compose([[triplet, chord(quarter, { pitch: spell(65) })]])))).toEqual([
            { pitch: 60, start: 0, duration: round(NOTE_LENGTH / 3) },
            { pitch: 62, start: 0.333333, duration: round(NOTE_LENGTH / 3) },
            { pitch: 64, start: 0.666667, duration: round(NOTE_LENGTH / 3) },
            { pitch: 65, start: 1, duration: NOTE_LENGTH },
        ]);
    });

    it('merges ties across barlines, but only into the next chord of the same voice', () => {
        const rest: Event = { kind: 'rest', duration: { base: 2, dots: 1 } };
        const notes = timeline(
            compose(
                [
                    [rest, chord(quarter, { pitch: spell(60), tie: true }, { pitch: spell(64), tie: true })],
                    [chord(quarter, { pitch: spell(67) })],
                ],
                [
                    // 60 continues; 64 isn't in the next chord, so its tie is dropped
                    [chord(quarter, { pitch: spell(60) }), chord(quarter, { pitch: spell(64) })],
                    // Same pitch, but a different voice
                    [chord(quarter, { pitch: spell(64) })],
                ],
            ),
        );
        expect(rounded(notes)).toEqual([
            { pitch: 67, start: 0, duration: NOTE_LENGTH },
            { pitch: 60, start: 3, duration: 1 + NOTE_LENGTH },
            { pitch: 64, start: 3, duration: NOTE_LENGTH },
            { pitch: 64, start: 4, duration: NOTE_LENGTH },
            { pitch: 64, start: 5, duration: NOTE_LENGTH },
        ]);
    });

    it('lets plain notes go just short of their length, and holds tenuto ones all of it', () => {
        const plain = chord(quarter, { pitch: spell(60) });
        const tenuto = chord(quarter, { pitch: spell(62), tenuto: true });
        expect(timeline(compose([[plain, tenuto]])).map(({ duration }) => duration)).toEqual([NOTE_LENGTH, 1]);
    });

    it('holds plain notes under a slur a little longer, through to the chord it ends on', () => {
        const slurred = (pitch: number, extra: Partial<Note> = {}): Chord => ({
            kind: 'chord',
            duration: quarter,
            notes: [{ pitch: spell(pitch), ...extra }],
            slur: true,
        });
        const notes = timeline(
            compose([[slurred(60), slurred(62, { staccato: true }), chord(quarter, { pitch: spell(64) }), chord(quarter, { pitch: spell(65) })]]),
        );
        // The staccato keeps its own length; the F after the slur's end is plain again
        expect(rounded(notes).map(({ duration }) => duration)).toEqual([SLURRED_LENGTH, 0.5, SLURRED_LENGTH, NOTE_LENGTH]);
    });

    it('keeps a note tied out of a slur slurred, to the end of the tie', () => {
        const start: Chord = { kind: 'chord', duration: quarter, notes: [{ pitch: spell(60) }], slur: true };
        const notes = timeline(compose([[start, chord(quarter, { pitch: spell(62), tie: true }), chord(quarter, { pitch: spell(62) })]]));
        expect(rounded(notes).map(({ duration }) => duration)).toEqual([SLURRED_LENGTH, round(1 + SLURRED_LENGTH)]);
    });

    it('shortens staccato notes', () => {
        expect(timeline(compose([[chord(quarter, { pitch: spell(60), staccato: true })]]))).toMatchObject([
            { pitch: 60, start: 0, duration: 0.5 },
        ]);
    });

    it('holds staccato notes three quarters of their length with tenuto too', () => {
        expect(timeline(compose([[chord(quarter, { pitch: spell(60), staccato: true, tenuto: true })]]))).toMatchObject([
            { pitch: 60, start: 0, duration: 0.75 },
        ]);
    });

    it('plays marcatos a little short, unless tenuto holds them', () => {
        const marcato = chord(quarter, { pitch: spell(60), marcato: true });
        const held = chord(quarter, { pitch: spell(62), marcato: true, tenuto: true });
        const short = chord(quarter, { pitch: spell(64), marcato: true, staccato: true });
        expect(timeline(compose([[marcato, held, short]])).map(({ duration }) => duration)).toEqual([MARCATO_LENGTH, 1, 0.5]);
    });

    it('strikes accents harder, and marcatos harder still', () => {
        const plain = chord(quarter, { pitch: spell(60) });
        const accented = chord(quarter, { pitch: spell(62), accent: true });
        const marcato = chord(quarter, { pitch: spell(64), marcato: true });
        const velocities = timeline(compose([[plain, accented, marcato]])).map(({ velocity }) => velocity);
        // mf, then 1.2 and 1.35 times as hard
        expect(velocities).toEqual([88, 106, 119]);
    });

    it('follows time signature and tempo changes in the example', () => {
        const notes = timeline(exampleComposition);
        // 4/4 at quarter = 120 lasts 2s, then 3/4 lasts 1.5s, so the 6/8 bass note starts at 3.5s
        // and lasts a measure at dotted quarter = 60, just short of it
        const lastBass = notes.filter((note) => note.pitch === 48).at(-1);
        expect(lastBass?.start).toBe(3.5);
        expect(lastBass?.duration).toBeCloseTo(2 * NOTE_LENGTH);
        // The tied C sounds for three eighths plus one, let go just short of the last
        expect(notes.find((note) => note.pitch === 72 && note.start === 3.5)?.duration).toBeCloseTo(1 + (1 / 3) * NOTE_LENGTH);
    });

    it('slides through the semitones between in the second half of the note, landing on the next', () => {
        const notes = timeline(compose([[chord(quarter, { pitch: spell(60), glissando: true }), chord(quarter, { pitch: spell(65) })]]));
        // Four steps from C to F fill the half second before the F
        expect(rounded(notes)).toEqual([
            { pitch: 60, start: 0, duration: 0.5 },
            { pitch: 61, start: 0.5, duration: 0.125 },
            { pitch: 62, start: 0.625, duration: 0.125 },
            { pitch: 63, start: 0.75, duration: 0.125 },
            { pitch: 64, start: 0.875, duration: 0.125 },
            { pitch: 65, start: 1, duration: NOTE_LENGTH },
        ]);
    });

    it('slides down, over a barline, to the top note of a chord', () => {
        const notes = timeline(
            compose(
                [[chord(quarter, { pitch: spell(60) }), chord(quarter, { pitch: spell(60) }), chord(quarter, { pitch: spell(60) }), chord(quarter, { pitch: spell(67), glissando: true })]],
                [[chord(quarter, { pitch: spell(60) }, { pitch: spell(64) })]],
            ),
        );
        expect(rounded(notes.filter(({ start }) => start >= 3 && start < 4))).toEqual([
            { pitch: 67, start: 3, duration: 0.5 },
            { pitch: 66, start: 3.5, duration: 0.25 },
            { pitch: 65, start: 3.75, duration: 0.25 },
        ]);
    });

    it("doesn't slide into a rest, or between neighbouring semitones", () => {
        const rest: Event = { kind: 'rest', duration: quarter };
        const intoRest = timeline(compose([[chord(quarter, { pitch: spell(60), glissando: true }), rest]]));
        expect(rounded(intoRest)).toEqual([{ pitch: 60, start: 0, duration: NOTE_LENGTH }]);
        const semitone = timeline(compose([[chord(quarter, { pitch: spell(60), glissando: true }), chord(quarter, { pitch: spell(61) })]]));
        expect(rounded(semitone).map(({ pitch }) => pitch)).toEqual([60, 61]);
    });
});
