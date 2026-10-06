import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Composition, newComposition, withTrailingEmptyMeasure } from '../composition/Composition';
import { cursorPitch } from '../cursor/Cursor';
import { Duration } from '../duration/Duration';
import { leaves } from '../event/Event';
import { Phantom } from '../phantom/Phantom';
import { deleteNote, deleteSelection, moveBeat, placeNote, placeRest, setLeafDuration, toggleArpeggios, transposeNote, transposeSelection } from './Edit';
import { pieces } from './Stream';
import { written } from './written';
import { midi, pitch, pitchName, spell } from '../pitch/Pitch';

/** Every pitch in a part's measure, chord by chord, with null for rests */
function pitches(composition: Composition, part: number, measure: number) {
    const events = composition.parts[part]!.measures[measure]!.voices[0]!.events;
    return [...leaves(events)].map(({ event }) => (event.kind === 'chord' ? event.notes.map((n) => midi(n.pitch)) : null));
}

const at = (part: number, measure: number, leaf: number) => ({ part, measure, voice: 0, leaf, note: 0 });

describe('transposeSelection', () => {
    it('moves every note of whole measures, in every part', () => {
        const moved = transposeSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 2, last: 2 }, -1);
        expect(pitches(moved, 0, 2)).toEqual([[71], [71], [71], null]);
        expect(pitches(moved, 1, 2)).toEqual([[47]]);
        expect(moved.parts[0]!.measures[0]).toBe(exampleComposition.parts[0]!.measures[0]);
        // Ties and staccato come along
        expect(moved.parts[0]!.measures[2]!.voices[0]!.events[0]).toMatchObject({ notes: [{ pitch: spell(71), tie: true }] });
    });

    it('spells the way it moves, keeping the spelling by octaves', () => {
        const selection = { kind: 'measures', firstPart: 0, lastPart: 0, first: 0, last: 0 } as const;
        const names = (composition: typeof exampleComposition) => {
            const event = composition.parts[0]!.measures[0]!.voices[0]!.events[0]!;
            return event.kind === 'chord' ? event.notes.map((note) => pitchName(note.pitch)) : [];
        };
        const down = transposeSelection(exampleComposition, selection, -1);
        expect(names(down)).toEqual(['B3', 'Eb4', 'Gb4']);
        expect(names(transposeSelection(exampleComposition, selection, 1))).toEqual(['C#4', 'F4', 'G#4']);
        expect(names(transposeSelection(down, selection, 12))).toEqual(['B4', 'Eb5', 'Gb5']);
    });

    it('moves only what a block covers, inside tuplets too', () => {
        const start = { measure: 1, offset: { num: 1, den: 12 } };
        const end = { measure: 1, offset: { num: 1, den: 6 } };
        const moved = transposeSelection(exampleComposition, { kind: 'block', firstPart: 0, lastPart: 1, start, end }, 2);
        expect(midi(cursorPitch(moved, at(0, 1, 0))!)).toBe(76);
        expect(midi(cursorPitch(moved, at(0, 1, 1))!)).toBe(76);
        expect(midi(cursorPitch(moved, at(0, 1, 2))!)).toBe(72);
        expect(midi(cursorPitch(moved, at(1, 1, 0))!)).toBe(43);
    });

    it('leaves everything alone if a note would leave the MIDI range', () => {
        const selection = { kind: 'measures', firstPart: 0, lastPart: 1, first: 0, last: 2 } as const;
        expect(transposeSelection(exampleComposition, selection, 60)).toBe(exampleComposition);
    });
});

const phantom = (note: number, base: Duration['base'], dots: Duration['dots'] = 0, staccato = false): Phantom => ({
    pitch: spell(note),
    duration: { base, dots },
    staccato,
});

// Melody measure 1 (4/4): C-E-G quarter, G-B-D quarter, C-E-G half
describe('placeNote', () => {
    it('removes a note placed again with the same value', () => {
        const placed = placeNote(exampleComposition, at(0, 0, 0), phantom(67, 4))!;
        expect(written(placed.composition, 0, 0)).toBe('60,64/q 55,59,62/q 60,64,67/h');
        // The cursor moves to the nearest note left
        expect(midi(cursorPitch(placed.composition, placed.cursor)!)).toBe(64);
    });

    it('leaves a rest when the last note goes', () => {
        expect(written(placeNote(exampleComposition, at(1, 0, 0), phantom(48, 1))!.composition, 1, 0)).toBe('r/w');
    });

    it('adds a pitch to a chord, and selects it', () => {
        const placed = placeNote(exampleComposition, at(0, 0, 0), phantom(72, 4))!;
        expect(written(placed.composition, 0, 0)).toBe('60,64,67,72/q 55,59,62/q 60,64,67/h');
        expect(midi(cursorPitch(placed.composition, placed.cursor)!)).toBe(72);
    });

    it('fills a rest', () => {
        expect(written(placeNote(exampleComposition, at(0, 2, 3), phantom(71, 8))!.composition, 0, 2)).toBe(
            '72~/q. 72/8 72!/8 71/8',
        );
    });

    it('changes the chord to a longer value, writing over what follows', () => {
        expect(written(placeNote(exampleComposition, at(0, 0, 0), phantom(67, 2))!.composition, 0, 0)).toBe(
            '60,64,67/h 60,64,67/h',
        );
        // Only partly covering the next chord turns the rest of it into a rest
        expect(written(placeNote(exampleComposition, at(0, 0, 0), phantom(67, 4, 1))!.composition, 0, 0)).toBe(
            '60,64,67/q. r/8 60,64,67/h',
        );
    });

    it('changes the chord to a shorter value, leaving a rest', () => {
        expect(written(placeNote(exampleComposition, at(0, 0, 0), phantom(67, 8))!.composition, 0, 0)).toBe(
            '60,64,67/8 r/8 55,59,62/q 60,64,67/h',
        );
    });

    it('merges the rests it leaves with the ones after', () => {
        const longer = placeNote(exampleComposition, at(0, 0, 0), phantom(67, 2, 1))!.composition;
        expect(written(longer, 0, 0)).toBe('60,64,67/h. r/q');
        expect(written(placeNote(longer, at(0, 0, 0), phantom(67, 8))!.composition, 0, 0)).toBe('60,64,67/8 r/8 r/q r/h');
    });

    it('keeps ties and sets staccato rather than removing', () => {
        expect(written(placeNote(exampleComposition, at(0, 2, 0), phantom(72, 4))!.composition, 0, 2)).toBe(
            '72~/q r/8 72/8 72!/8 r/8',
        );
        expect(written(placeNote(exampleComposition, at(0, 0, 0), phantom(67, 4, 0, true))!.composition, 0, 0)).toBe(
            '60,64,67!/q 55,59,62/q 60,64,67/h',
        );
    });

    it('respells a note placed again with another spelling, rather than removing it', () => {
        const fFlat: Phantom = { ...phantom(64, 4), pitch: pitch('Fb4') };
        const placed = placeNote(exampleComposition, at(0, 0, 0), fFlat)!;
        expect(written(placed.composition, 0, 0)).toBe('60,64,67/q 55,59,62/q 60,64,67/h');
        expect(cursorPitch(placed.composition, placed.cursor)).toEqual(pitch('Fb4'));
    });

    it('works within a tuplet, in its written values', () => {
        const placed = placeNote(exampleComposition, at(0, 1, 0), phantom(76, 4))!;
        expect(written(placed.composition, 0, 1)).toMatch(/^\[76\/q 72\/8\] \[/);
    });

    it('refuses values that run past the end of the measure or tuplet', () => {
        expect(placeNote(exampleComposition, at(0, 0, 2), phantom(67, 1))).toBeUndefined();
        expect(placeNote(exampleComposition, at(0, 1, 2), phantom(72, 4))).toBeUndefined();
    });
});

describe('toggleArpeggios', () => {
    const leaf = (measure: number, leaf: number) => ({ part: 0, measure, voice: 0, leaf });

    it('rolls chords, and unrolls them when every one already is', () => {
        const rolled = toggleArpeggios(exampleComposition, [leaf(0, 0), leaf(0, 1)])!;
        expect(written(rolled, 0, 0)).toBe('arp:60,64,67/q arp:55,59,62/q 60,64,67/h');
        expect(written(toggleArpeggios(rolled, [leaf(0, 0), leaf(0, 1)])!, 0, 0)).toBe('60,64,67/q 55,59,62/q 60,64,67/h');
        // Only some rolled: they all roll
        expect(written(toggleArpeggios(rolled, [leaf(0, 1), leaf(0, 2)])!, 0, 0)).toBe('arp:60,64,67/q arp:55,59,62/q arp:60,64,67/h');
    });

    it('skips rests, doing nothing with only rests', () => {
        expect(toggleArpeggios(exampleComposition, [leaf(2, 3)])).toBeUndefined();
        expect(written(toggleArpeggios(exampleComposition, [leaf(2, 2), leaf(2, 3)])!, 0, 2)).toBe('72~/q. 72/8 arp:72!/8 r/8');
    });

    it('stays rolled as notes are added and taken away', () => {
        const rolled = toggleArpeggios(exampleComposition, [leaf(0, 0)])!;
        expect(written(placeNote(rolled, at(0, 0, 0), phantom(72, 4))!.composition, 0, 0)).toBe('arp:60,64,67,72/q 55,59,62/q 60,64,67/h');
        expect(written(placeNote(rolled, at(0, 0, 0), phantom(67, 4))!.composition, 0, 0)).toBe('arp:60,64/q 55,59,62/q 60,64,67/h');
    });

    it('rolls only the first piece of a split chord, where it is struck', () => {
        const half: Duration = { base: 2, dots: 0 };
        const split = pieces({ kind: 'chord', duration: half, notes: [{ pitch: spell(60) }, { pitch: spell(64) }], arpeggio: true }, [
            { base: 4, dots: 0 },
            { base: 4, dots: 0 },
        ]);
        expect(split.map((piece) => piece.kind === 'chord' && !!piece.arpeggio)).toEqual([true, false]);
    });
});

describe('transposeNote', () => {
    const note = (measure: number, leaf: number, index: number) => ({ ...at(0, measure, leaf), note: index });

    it('moves one note of a chord, keeping it sorted and selected', () => {
        const up = transposeNote(exampleComposition, note(0, 0, 2), 1)!;
        expect(written(up.composition, 0, 0)).toBe('60,64,68/q 55,59,62/q 60,64,67/h');
        expect(midi(cursorPitch(up.composition, up.cursor)!)).toBe(68);

        // E up past G reorders the chord
        const past = transposeNote(exampleComposition, note(0, 0, 1), 5)!;
        expect(written(past.composition, 0, 0)).toBe('60,67,69/q 55,59,62/q 60,64,67/h');
        expect(past.cursor.note).toBe(2);
    });

    it('spells a black key sharp going up and flat going down', () => {
        const up = transposeNote(exampleComposition, note(0, 0, 2), 1)!;
        expect(cursorPitch(up.composition, up.cursor)).toEqual(pitch('G#4'));
        const down = transposeNote(exampleComposition, note(0, 0, 2), -1)!;
        expect(cursorPitch(down.composition, down.cursor)).toEqual(pitch('Gb4'));
        // Back to a white key, it's natural again
        const back = transposeNote(down.composition, down.cursor, 1)!;
        expect(cursorPitch(back.composition, back.cursor)).toEqual(pitch('G4'));
    });

    it('refuses rests, doubled pitches and leaving MIDI range', () => {
        expect(transposeNote(exampleComposition, note(2, 3, 0), 1)).toBeUndefined();
        expect(transposeNote(exampleComposition, note(0, 0, 1), 3)).toBeUndefined();
        expect(transposeNote(exampleComposition, note(0, 0, 2), 100)).toBeUndefined();
    });
});

describe('deleteSelection', () => {
    const block = (firstPart: number, lastPart: number, start: [number, number, number], end: [number, number, number]) =>
        ({
            kind: 'block',
            firstPart,
            lastPart,
            start: { measure: start[0], offset: { num: start[1], den: start[2] } },
            end: { measure: end[0], offset: { num: end[1], den: end[2] } },
        }) as const;

    it('turns whole measures into a measure rest in every part', () => {
        const deleted = deleteSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 0, last: 0 });
        expect(written(deleted, 0, 0)).toBe('r/w');
        expect(written(deleted, 1, 0)).toBe('r/w');
        expect(deleted.parts[0]!.measures[1]).toBe(exampleComposition.parts[0]!.measures[1]);
        // 3/4 takes a single dotted half rest
        expect(written(deleteSelection(exampleComposition, { kind: 'measures', firstPart: 0, lastPart: 1, first: 1, last: 1 }), 0, 1)).toBe('r/h.');
    });

    it('leaves rests in place of chords, merged on the beat', () => {
        const deleted = deleteSelection(exampleComposition, block(0, 0, [0, 1, 4], [0, 1, 1]));
        expect(written(deleted, 0, 0)).toBe('60,64,67/q r/q r/h');
        expect(written(deleted, 1, 0)).toBe('48/w');
    });

    it('deletes inside tuplets', () => {
        const deleted = deleteSelection(exampleComposition, block(0, 0, [1, 1, 12], [1, 1, 6]));
        expect(written(deleted, 0, 1)).toMatch(/^\[76\/8 r\/8 72\/8\] \[/);
    });
});

describe('deleteNote', () => {
    const note = (part: number, measure: number, leaf: number, index: number) => ({ ...at(part, measure, leaf), note: index });

    it('takes one note out of a chord, moving to the nearest one left', () => {
        const deleted = deleteNote(exampleComposition, note(0, 0, 0, 2))!;
        expect(written(deleted.composition, 0, 0)).toBe('60,64/q 55,59,62/q 60,64,67/h');
        expect(midi(cursorPitch(deleted.composition, deleted.cursor)!)).toBe(64);
    });

    it('leaves a rest for the last note, merged with rests beside it', () => {
        expect(written(deleteNote(exampleComposition, note(1, 0, 0, 0))!.composition, 1, 0)).toBe('r/w');

        // The staccato C and the eighth rest after it become a quarter rest
        const deleted = deleteNote(exampleComposition, note(0, 2, 2, 0))!;
        expect(written(deleted.composition, 0, 2)).toBe('72~/q. 72/8 r/q');
        expect(deleted.cursor).toEqual(note(0, 2, 2, 0));
    });

    it('does nothing on a rest', () => {
        expect(deleteNote(exampleComposition, note(0, 2, 3, 0))).toBeUndefined();
    });
});

describe('setLeafDuration', () => {
    const quarter = { base: 4, dots: 0 } as const;

    it('changes the whole chord, writing over or leaving rests', () => {
        expect(written(setLeafDuration(exampleComposition, at(0, 0, 0), { base: 2, dots: 0 })!, 0, 0)).toBe(
            '60,64,67/h 60,64,67/h',
        );
        expect(written(setLeafDuration(exampleComposition, at(0, 0, 0), { base: 8, dots: 0 })!, 0, 0)).toBe(
            '60,64,67/8 r/8 55,59,62/q 60,64,67/h',
        );
    });

    it('drops the dot, keeping ties and staccato', () => {
        expect(written(setLeafDuration(exampleComposition, at(0, 2, 0), quarter)!, 0, 2)).toBe('72~/q r/8 72/8 72!/8 r/8');
    });

    it('changes rests too', () => {
        expect(written(setLeafDuration(exampleComposition, at(0, 2, 3), { base: 16, dots: 0 })!, 0, 2)).toBe(
            '72~/q. 72/8 72!/8 r/16 r/16',
        );
    });

    it('does nothing for the same value or one that does not fit', () => {
        expect(setLeafDuration(exampleComposition, at(0, 0, 0), quarter)).toBeUndefined();
        expect(setLeafDuration(exampleComposition, at(0, 0, 2), { base: 1, dots: 0 })).toBeUndefined();
    });
});

describe('moveBeat', () => {
    // Measure 3 is the empty measure a session keeps at the end, in 6/8 like the one before
    const score = withTrailingEmptyMeasure(exampleComposition);
    const leafAfter = (from: ReturnType<typeof at>, delta: number) => {
        const { cursor } = moveBeat(score, from, delta);
        return [cursor.measure, cursor.leaf];
    };

    it('goes to the chord on the next beat, passing beats a chord is held over', () => {
        expect(leafAfter(at(0, 0, 0), 1)).toEqual([0, 1]);
        expect(leafAfter(at(0, 0, 0), 2)).toEqual([0, 2]);
        // The half note holds beat 4, so the next is the next measure's first
        expect(leafAfter(at(0, 0, 0), 3)).toEqual([1, 0]);
        expect(leafAfter(at(1, 0, 0), 1)).toEqual([1, 0]);
    });

    it('goes back to what sounds on the beat before, across the barline', () => {
        expect(leafAfter(at(0, 1, 0), -1)).toEqual([0, 2]);
        expect(leafAfter(at(0, 0, 2), -1)).toEqual([0, 1]);
        expect(leafAfter(at(0, 0, 0), -1)).toEqual([0, 0]);
    });

    it('counts beats in tuplets and dotted quarters in compound time', () => {
        // The quintuplet starts the second beat of the 3/4 measure
        expect(leafAfter(at(0, 1, 0), 1)).toEqual([1, 3]);
        // 6/8's second beat is the eighth after the dotted quarter
        expect(leafAfter(at(0, 3, 0), -1)).toEqual([2, 1]);
    });

    it('splits a rest across the beat, to land on it', () => {
        const empty = withTrailingEmptyMeasure(newComposition());
        const moved = moveBeat(empty, at(0, 0, 0), 1);
        expect(written(moved.composition, 0, 0)).toBe('r/q r/q r/h');
        expect(moved.cursor).toMatchObject({ measure: 0, leaf: 1 });
        expect(written(moveBeat(empty, at(0, 0, 0), 3).composition, 0, 0)).toBe('r/q r/q r/q r/q');

        // A half rest, then a quarter note on beat 3
        const rested = placeRest(empty, at(0, 0, 0), { base: 2, dots: 0 })!.composition;
        const noted = placeNote(rested, at(0, 0, 1), phantom(72, 4))!.composition;
        const back = moveBeat(noted, at(0, 0, 1), -1);
        expect(written(back.composition, 0, 0)).toBe('r/q r/q 72/q r/q');
        expect(back.cursor).toMatchObject({ measure: 0, leaf: 1 });
    });

    it('leaves a rest in a tuplet whole', () => {
        const rested = placeRest(score, at(0, 1, 1), { base: 8, dots: 0 })!.composition;
        expect(moveBeat(rested, at(0, 1, 0), 1).composition).toBe(rested);
    });

    it('stops at the ends of the part', () => {
        expect(moveBeat(score, at(0, 0, 0), -1).composition).toBe(score);
        // The empty 6/8 measure's dotted half rest is split on its second beat
        const last = moveBeat(score, at(0, 3, 0), 9);
        expect(written(last.composition, 0, 3)).toBe('r/q r/8 r/8 r/q');
        expect(last.cursor).toMatchObject({ measure: 3, leaf: 2 });
    });
});
