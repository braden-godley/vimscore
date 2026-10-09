import { Composition, MAX_SWING } from '../composition/Composition';
import { Chord, glissandoTarget, leaves } from '../event/Event';
import { Fraction, ZERO, add, compare, sub, toNumber } from '../fraction/Fraction';
import {
    DEFAULT_DYNAMIC,
    DYNAMIC_STEP,
    LOUDEST_VELOCITY,
    SOFTEST_VELOCITY,
    dynamicVelocity,
} from '../dynamic/Dynamic';
import { HairpinKind, ResolvedMeasure, Voice, resolveMeasures, secondsPerWholeNote } from '../measure/Measure';
import { Note } from '../note/Note';
import { Part } from '../part/Part';
import { PerformanceOptions, performance } from './performance';
import { midi } from '../pitch/Pitch';

/** A note as it sounds, in seconds from the start of the composition */
export interface TimedNote {
    /** Index of the part playing it */
    part: number;
    pitch: number;
    start: number;
    duration: number;
    /** MIDI velocity, 1 to 127, from the part's dynamics and hairpins and the note's accent */
    velocity: number;
}

/** A dynamic marking's velocity, or a hairpin from `time` to `end` */
type DynamicChange =
    | { time: Fraction; velocity: number }
    | { time: Fraction; end: Fraction; kind: HairpinKind; velocity?: number };

/**
 * A part's dynamic markings and hairpins in order, by time from the start of the composition. A
 * hairpin without a dynamic of its own aims for a marking right at its end, if there is one.
 */
function dynamicChanges(part: Part, measures: ResolvedMeasure[]): DynamicChange[] {
    const marks = part.measures.flatMap((partMeasure, m) =>
        (partMeasure.dynamics ?? []).map(({ offset, dynamic }) => ({
            time: add(measures[m]!.start, offset),
            velocity: dynamicVelocity(dynamic),
        })),
    );
    const hairpins = part.measures.flatMap((partMeasure, m) =>
        (partMeasure.hairpins ?? []).map(({ offset, length, kind, dynamic }) => {
            const time = add(measures[m]!.start, offset);
            const end = add(time, length);
            const velocity = dynamic ? dynamicVelocity(dynamic) : marks.find((mark) => compare(mark.time, end) === 0)?.velocity;
            return { time, end, kind, velocity };
        }),
    );
    // A hairpin starting on a marking starts from it
    return [...marks, ...hairpins].sort((a, b) => compare(a.time, b.time) || Number('end' in a) - Number('end' in b));
}

/**
 * The velocity in effect at a time: the last marking's at or before it, or partway along a
 * hairpin. A hairpin goes from wherever the dynamic was when it started, and with nothing to aim
 * for, one dynamic louder or softer; a marking inside one cuts it short.
 */
function velocityAt(changes: DynamicChange[], time: Fraction): number {
    let velocity = dynamicVelocity(DEFAULT_DYNAMIC);
    for (const change of changes) {
        if (compare(change.time, time) > 0) break;
        if (!('end' in change)) {
            velocity = change.velocity;
            continue;
        }
        const step = change.kind === 'crescendo' ? DYNAMIC_STEP : -DYNAMIC_STEP;
        const target = change.velocity ?? Math.max(SOFTEST_VELOCITY, Math.min(LOUDEST_VELOCITY, velocity + step));
        const length = toNumber(sub(change.end, change.time));
        const progress = length > 0 ? Math.min(1, toNumber(sub(time, change.time)) / length) : 1;
        velocity += (target - velocity) * progress;
    }
    return velocity;
}

/** How much louder an accented note is struck, and a marcato one */
export const ACCENT_BOOST = 1.2;
export const MARCATO_BOOST = 1.35;

/** A note's velocity with its accent or marcato, no harder than MIDI goes */
function accented(note: Note, velocity: number): number {
    const boost = note.marcato ? MARCATO_BOOST : note.accent ? ACCENT_BOOST : 1;
    return Math.round(Math.min(LOUDEST_VELOCITY, velocity * boost));
}

/**
 * How much of its written length a plain note sounds, leaving a little gap so repeated notes
 * sound apart, and one under a slur, held on into the next; a tenuto note is held all of it
 */
export const NOTE_LENGTH = 0.95;
export const SLURRED_LENGTH = 1;

/** How much of its written length a marcato note sounds, a little short of it */
export const MARCATO_LENGTH = 0.8;

/**
 * How much of its written length a note sounds: half for staccato, three quarters with tenuto
 * too. A marcato is a little short, unless tenuto holds it, and a plain note just short of full,
 * or all of it under a slur
 */
function heldFor(note: Note, slurred: boolean): number {
    if (note.staccato) return note.tenuto ? 3 / 4 : 1 / 2;
    if (note.tenuto) return 1;
    if (note.marcato) return MARCATO_LENGTH;
    return slurred ? SLURRED_LENGTH : NOTE_LENGTH;
}

/** Seconds between the notes of a rolled chord */
export const ARPEGGIO_STEP = 0.05;

/** A roll takes at most half its chord, so a fast one still lands every note before the next */
function arpeggioStep(notes: number, seconds: number): number {
    return notes < 2 ? 0 : Math.min(ARPEGGIO_STEP, seconds / 2 / (notes - 1));
}

/**
 * How much of a beat a swung pair of eighths gives the first: half when straight, up to three
 * quarters (a dotted eighth and a sixteenth) at the most swing. About 7 is triplet swing.
 */
export function swingRatio(swing: number): number {
    return 0.5 + (0.25 * Math.max(0, Math.min(MAX_SWING, swing))) / MAX_SWING;
}

/**
 * Where a moment in a voice's measure (in whole notes from its start) is played once swung.
 * Swing goes by quarter-note beats, so it only applies in time signatures counting quarters or
 * halves, and only to the beats where something in the voice starts on the eighth between:
 * there, the first half of the beat is stretched and the second squeezed. Quarter notes and
 * triplets play straight, and sixteenths are swung along with the eighths they fill.
 */
function swungTime(measure: ResolvedMeasure, voice: Voice, ratio: number): (offset: Fraction) => number {
    if (ratio === 0.5 || measure.timeSignature.beatValue > 4) return toNumber;
    const swung = new Set<number>();
    let offset = ZERO;
    for (const { length } of leaves(voice.events)) {
        // An odd number of eighths in is between the beats
        if (offset.den === 8) swung.add(Math.floor(toNumber(offset) * 4));
        offset = add(offset, length);
    }
    return (at) => {
        const time = toNumber(at);
        const beat = Math.floor(time * 4);
        if (!swung.has(beat)) return time;
        const into = time - beat / 4;
        const swungInto = into < 1 / 8 ? into * 2 * ratio : ratio / 4 + (into - 1 / 8) * 2 * (1 - ratio);
        return beat / 4 + swungInto;
    };
}

/** A note sliding on to the next chord in its voice, waiting to find out where it lands */
interface Glide {
    timed: TimedNote;
    index: number;
    chord: Chord;
    /** Where the slide leaves the note, and where the next chord starts */
    from: number;
    to: number;
}

/**
 * The slide from a note to `target`: it holds for the first half of its last chord, then steps
 * chromatically through the pitches in between in the second half, landing on the next chord.
 */
function slide({ timed, from, to }: Glide, target: number): TimedNote[] {
    const steps = Math.abs(target - timed.pitch) - 1;
    if (steps < 1) return [];
    timed.duration = from - timed.start;
    const direction = Math.sign(target - timed.pitch);
    const step = (to - from) / steps;
    return Array.from({ length: steps }, (_, i) => ({
        ...timed,
        pitch: timed.pitch + direction * (i + 1),
        start: from + i * step,
        duration: step,
    }));
}

/**
 * Resolves a composition into the notes it plays, sorted by start time, playing repeats. Tied
 * notes are merged into one, plain notes sound just short of their written length (all of it
 * under a slur), tenuto ones all of it, staccato ones half (three quarters with tenuto) and
 * marcatos a little short, accents and marcatos are struck louder, an arpeggio's notes come in
 * one after another from the bottom, all ending together, and a glissando runs through the
 * semitones on the way to its next note. Eighths are swung as much as the composition asks.
 */
export function timeline(composition: Composition, options: PerformanceOptions = {}): TimedNote[] {
    const measures = resolveMeasures(composition.measures);
    const played = performance(composition, options);
    const ratio = swingRatio(composition.swing ?? 0);
    const notes: TimedNote[] = [];

    for (const [partIndex, part] of composition.parts.entries()) {
        const dynamics = dynamicChanges(part, measures);
        // Per voice index, notes from the previous chord that are tied into the next one
        const tiedByVoice = new Map<number, Map<number, TimedNote>>();
        // Per voice index, notes from the previous chord that slide into the next one
        const glidesByVoice = new Map<number, Glide[]>();
        // Per voice index, whether the previous chord slurs into the next one
        const slurredByVoice = new Map<number, boolean>();
        // Notes struck under a slur, which stay slurred through any ties
        const slurredNotes = new WeakSet<TimedNote>();

        if (part.measures.length > measures.length) {
            throw new Error(`Part "${part.name}" has more measures than the composition`);
        }

        // In the order the measures are played, repeats and all
        played.forEach(({ measure: measureIndex, startSeconds }, i) => {
            const measure = measures[measureIndex]!;
            const partMeasure = part.measures[measureIndex];
            if (!partMeasure) return;
            const secondsPerWhole = secondsPerWholeNote(measure.tempo);
            // A tie doesn't carry back over a repeat to the start of the section
            if (i > 0 && played[i - 1]!.measure !== measureIndex - 1) {
                tiedByVoice.clear();
                glidesByVoice.clear();
                slurredByVoice.clear();
            }

            partMeasure.voices.forEach((voice, voiceIndex) => {
                const time = swungTime(measure, voice, ratio);
                let offset = ZERO;

                for (const { event, length } of leaves(voice.events)) {
                    const start = startSeconds + time(offset) * secondsPerWhole;
                    const seconds = startSeconds + time(add(offset, length)) * secondsPerWhole - start;
                    const tiedIn = tiedByVoice.get(voiceIndex);
                    const tiedOut = new Map<number, TimedNote>();
                    const glides: Glide[] = [];

                    // A slide into a rest goes nowhere
                    for (const glide of glidesByVoice.get(voiceIndex) ?? []) {
                        if (event.kind !== 'chord') continue;
                        const target = event.notes[glissandoTarget(glide.index, glide.chord, event)]!;
                        notes.push(...slide(glide, midi(target.pitch)));
                    }

                    // Under a slur from the chord before, or carrying one on to the next
                    const slurred = event.kind === 'chord' && (slurredByVoice.get(voiceIndex) || !!event.slur);

                    if (event.kind === 'chord') {
                        // An arpeggio rolls up through the notes it strikes; held ties are already sounding
                        const struck = event.notes.map(({ pitch }) => midi(pitch)).filter((pitch) => !tiedIn?.has(pitch));
                        struck.sort((a, b) => a - b);
                        const step = event.arpeggio ? arpeggioStep(struck.length, seconds) : 0;

                        for (const note of event.notes) {
                            const pitch = midi(note.pitch);
                            let timed = tiedIn?.get(pitch);
                            if (!timed) {
                                const velocity = accented(note, velocityAt(dynamics, add(measure.start, offset)));
                                const delay = struck.indexOf(pitch) * step;
                                timed = { part: partIndex, pitch, start: start + delay, duration: 0, velocity };
                                notes.push(timed);
                                if (slurred) slurredNotes.add(timed);
                            }
                            const end = start + seconds * heldFor(note, slurred || slurredNotes.has(timed));
                            timed.duration = end - timed.start;
                            if (note.tie) tiedOut.set(pitch, timed);
                            if (note.glissando) {
                                const index = event.notes.indexOf(note);
                                glides.push({ timed, index, chord: event, from: start + seconds / 2, to: start + seconds });
                            }
                        }
                    }

                    tiedByVoice.set(voiceIndex, tiedOut);
                    glidesByVoice.set(voiceIndex, glides);
                    slurredByVoice.set(voiceIndex, event.kind === 'chord' && !!event.slur);
                    offset = add(offset, length);
                }
            });
        });
    }

    return notes.sort((a, b) => a.start - b.start);
}
