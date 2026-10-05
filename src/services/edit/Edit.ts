/**
 * Changes to a composition. Each takes the composition and returns a new one, leaving the
 * original untouched, so the editor can hand edits back like any other result.
 */

import { Composition } from '../composition/Composition';
import { Cursor, clampCursor, cursorAtOffset, cursorOffset, voiceLeaves, withNote } from '../cursor/Cursor';
import { Duration, durationValue, durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, eventsLength, mapLeaves } from '../event/Event';
import { Fraction, ZERO, add, compare, sub } from '../fraction/Fraction';
import { resolveMeasures } from '../measure/Measure';
import { Note } from '../note/Note';
import { Phantom } from '../phantom/Phantom';
import { Selection, selectedLeaves } from '../selection/Selection';

const LOWEST_PITCH = 0;
const HIGHEST_PITCH = 127;

/**
 * Moves every note in the selection by `semitones`. If that would take any note out of MIDI's
 * range, nothing moves, so chords keep their shape.
 */
export function transposeSelection(composition: Composition, selection: Selection, semitones: number): Composition {
    const leafRefs = selectedLeaves(composition, selection);
    const selected = new Set(leafRefs.map(({ part, measure, voice, leaf }) => `${part}-${measure}-${voice}-${leaf}`));
    const touched = new Set(leafRefs.map(({ part, measure }) => `${part}-${measure}`));
    let outOfRange = false;

    // Measures outside the selection are shared with the original rather than copied
    const parts = composition.parts.map((part, p) => ({
        ...part,
        measures: part.measures.map((partMeasure, m) => {
            if (!touched.has(`${p}-${m}`)) return partMeasure;
            return {
                ...partMeasure,
                voices: partMeasure.voices.map((voice, v) => ({
                    ...voice,
                    events: mapLeaves(voice.events, (event, leaf) => {
                        if (event.kind !== 'chord' || !selected.has(`${p}-${m}-${v}-${leaf}`)) return event;
                        const notes = event.notes.map((note) => ({ ...note, pitch: note.pitch + semitones }));
                        if (notes.some(({ pitch }) => pitch < LOWEST_PITCH || pitch > HIGHEST_PITCH)) outOfRange = true;
                        return { ...event, notes };
                    }),
                })),
            };
        }),
    }));

    return outOfRange ? composition : { ...composition, parts };
}

/** Swaps in new events for the cursor's voice in its measure, sharing everything else */
function withVoiceEvents(composition: Composition, { part, measure, voice }: Cursor, events: Event[]): Composition {
    const replace = <T>(list: T[], index: number, fn: (item: T) => T) => list.map((item, i) => (i === index ? fn(item) : item));
    return {
        ...composition,
        parts: replace(composition.parts, part, (p) => ({
            ...p,
            measures: replace(p.measures, measure, (m) => ({
                ...m,
                voices: replace(m.voices, voice, (v) => ({ ...v, events })),
            })),
        })),
    };
}

function sameDuration(a: Duration, b: Duration): boolean {
    return a.base === b.base && a.dots === b.dots;
}

/**
 * Finds the list of events holding a leaf (the voice itself, or the tuplet it's in) and hands
 * it to `rewrite`, rebuilding any tuplets around the result. Undefined if `rewrite` refuses.
 */
function rewriteAroundLeaf(
    events: Event[],
    target: number,
    rewrite: (list: Event[], index: number, inTuplet: boolean) => Event[] | undefined,
): Event[] | undefined {
    let seen = 0;
    const NOT_HERE = null;
    const visit = (list: Event[], inTuplet: boolean): Event[] | undefined | typeof NOT_HERE => {
        for (const [i, event] of list.entries()) {
            if (event.kind === 'tuplet') {
                const inner = visit(event.events, true);
                if (inner === NOT_HERE) continue;
                return inner && list.map((other, j) => (j === i ? { ...event, events: inner } : other));
            }
            if (seen++ === target) return rewrite(list, i, inTuplet);
        }
        return NOT_HERE;
    };
    return visit(events, false) ?? undefined;
}

/**
 * Puts `replacement` at `index`, writing over whatever it now covers. A longer value takes over
 * the time of the events after it, and anything it only partly covers becomes rests; a shorter
 * one leaves rests behind it. Rests next to the change are merged and laid out on the beat. Lengths here are as written in `list`, so inside a tuplet they're
 * unscaled. Undefined if it would run past `capacity` or leave a gap no rests can fill.
 */
function overwrite(list: Event[], index: number, replacement: Chord | Rest, capacity: Fraction): Event[] | undefined {
    const start = eventsLength(list.slice(0, index));
    const end = add(start, durationValue(replacement.duration));
    if (compare(end, capacity) > 0) return undefined;

    let next = index;
    let covered = start;
    while (next < list.length && compare(covered, end) < 0) {
        covered = add(covered, eventsLength([list[next]!]));
        next++;
    }
    // Rests right after are rewritten along with the gap, so they merge rather than pile up
    while (list[next]?.kind === 'rest') {
        covered = add(covered, eventsLength([list[next]!]));
        next++;
    }

    let rests: Rest[];
    try {
        const gap = compare(covered, end) > 0 ? sub(covered, end) : ZERO;
        rests = restsFilling(end, gap).map((duration) => ({ kind: 'rest', duration }));
    } catch {
        return undefined;
    }
    return [...list.slice(0, index), replacement, ...rests, ...list.slice(next)];
}

/**
 * Insert mode's place command, at the cursor's chord or rest:
 * - the phantom's pitch is already there, with the same value and articulation: it's removed,
 *   leaving a rest if it was the only note
 * - otherwise the pitch is added (or kept) and the chord takes the phantom's value and staccato
 *   for that note. A chord has one value, so every note in it changes length together.
 * Undefined when the new value doesn't fit before the end of the measure (or tuplet). `placed`
 * is the chord now holding the note, or undefined if the note was removed.
 */
export function placeNote(
    composition: Composition,
    cursor: Cursor,
    phantom: Phantom,
): { composition: Composition; cursor: Cursor; placed?: Chord } | undefined {
    const { part, measure, voice, leaf } = cursor;
    const event = voiceLeaves(composition, part, measure, voice)[leaf]?.event;
    const events = composition.parts[part]?.measures[measure]?.voices[voice]?.events;
    const measureLength = resolveMeasures(composition.measures)[measure]?.length;
    if (!event || !events || !measureLength) return undefined;

    const notes = event.kind === 'chord' ? event.notes : [];
    const existing = notes.find(({ pitch }) => pitch === phantom.pitch);
    const others = notes.filter((note) => note !== existing);

    let replacement: Chord | Rest;
    if (existing && sameDuration(event.duration, phantom.duration) && !!existing.staccato === phantom.staccato) {
        replacement =
            others.length > 0
                ? { kind: 'chord', duration: event.duration, notes: others }
                : { kind: 'rest', duration: event.duration };
    } else {
        // Keeps a tie the note already had
        const { staccato: _, ...kept }: Note = existing ?? { pitch: phantom.pitch };
        const placed: Note = phantom.staccato ? { ...kept, staccato: true } : kept;
        const sorted = [...others, placed].sort((a, b) => a.pitch - b.pitch);
        replacement = { kind: 'chord', duration: phantom.duration, notes: sorted };
    }

    const newEvents = rewriteAroundLeaf(events, leaf, (list, index, inTuplet) =>
        overwrite(list, index, replacement, inTuplet ? eventsLength(list) : measureLength),
    );
    if (!newEvents) return undefined;

    const edited = withVoiceEvents(composition, cursor, newEvents);
    const placed =
        replacement.kind === 'chord' && replacement.notes.some(({ pitch }) => pitch === phantom.pitch)
            ? replacement
            : undefined;
    return { composition: edited, cursor: withNote(edited, clampCursor(edited, cursor), phantom.pitch), placed };
}

/**
 * Moves the cursor's note by `semitones`, keeping the chord sorted by pitch and the cursor on
 * the note that moved. Undefined on a rest, past MIDI's range, or onto a pitch the chord
 * already has.
 */
export function transposeNote(
    composition: Composition,
    cursor: Cursor,
    semitones: number,
): { composition: Composition; cursor: Cursor } | undefined {
    const { part, measure, voice, leaf } = cursor;
    const event = voiceLeaves(composition, part, measure, voice)[leaf]?.event;
    const events = composition.parts[part]?.measures[measure]?.voices[voice]?.events;
    const moving = event?.kind === 'chord' ? event.notes[cursor.note] : undefined;
    if (!event || event.kind !== 'chord' || !events || !moving) return undefined;

    const pitch = moving.pitch + semitones;
    if (pitch < LOWEST_PITCH || pitch > HIGHEST_PITCH) return undefined;
    if (event.notes.some((note) => note !== moving && note.pitch === pitch)) return undefined;

    const moved = { ...moving, pitch };
    const notes = event.notes.map((note) => (note === moving ? moved : note)).sort((a, b) => a.pitch - b.pitch);
    const edited = withVoiceEvents(
        composition,
        cursor,
        mapLeaves(events, (other, i) => (i === leaf ? { ...event, notes } : other)),
    );
    return { composition: edited, cursor: { ...cursor, note: notes.indexOf(moved) } };
}

const rest = (duration: Duration): Rest => ({ kind: 'rest', duration });

/** Rests for a length in as few values as possible, or undefined if note values can't write it */
function restsFor(length: Fraction): Rest[] | undefined {
    try {
        return durationsFilling(length).map(rest);
    } catch {
        return undefined;
    }
}

/**
 * Tidies rests: a tuplet of nothing but rests becomes plain rests, runs of rests become the
 * fewest rests on the beat, and a measure of only rests becomes one rest where one value fits.
 */
function mergeRests(list: Event[], top = true): Event[] {
    const simplified = list.flatMap((event): Event[] => {
        if (event.kind !== 'tuplet') return [event];
        const events = mergeRests(event.events, false);
        const silent = events.every(({ kind }) => kind === 'rest');
        return (silent && restsFor(eventsLength([event]))) || [{ ...event, events }];
    });
    if (top && simplified.every(({ kind }) => kind === 'rest')) {
        const whole = restsFor(eventsLength(simplified));
        if (whole) return whole;
    }

    const result: Event[] = [];
    let position = ZERO;
    let run: Rest[] = [];
    let runStart = ZERO;
    const flush = () => {
        let merged: Rest[] | undefined;
        if (run.length > 1) {
            try {
                merged = restsFilling(runStart, eventsLength(run)).map(rest);
            } catch {
                // Leaves the run as it was
            }
        }
        result.push(...(merged ?? run));
        run = [];
    };

    for (const event of simplified) {
        if (event.kind === 'rest') {
            if (run.length === 0) runStart = position;
            run.push(event);
        } else {
            flush();
            result.push(event);
        }
        position = add(position, eventsLength([event]));
    }
    flush();
    return result;
}

/** Turns every selected chord into a rest of the same length, then tidies the rests */
export function deleteSelection(composition: Composition, selection: Selection): Composition {
    const leafRefs = selectedLeaves(composition, selection);
    const selected = new Set(leafRefs.map(({ part, measure, voice, leaf }) => `${part}-${measure}-${voice}-${leaf}`));
    const touched = new Set(leafRefs.map(({ part, measure, voice }) => `${part}-${measure}-${voice}`));
    if (leafRefs.length === 0) return composition;

    return {
        ...composition,
        parts: composition.parts.map((part, p) => ({
            ...part,
            measures: part.measures.map((partMeasure, m) => {
                if (!partMeasure.voices.some((_, v) => touched.has(`${p}-${m}-${v}`))) return partMeasure;
                return {
                    ...partMeasure,
                    voices: partMeasure.voices.map((voice, v) => {
                        if (!touched.has(`${p}-${m}-${v}`)) return voice;
                        const events = mapLeaves(voice.events, (event, leaf) =>
                            event.kind === 'chord' && selected.has(`${p}-${m}-${v}-${leaf}`)
                                ? rest(event.duration)
                                : event,
                        );
                        return { ...voice, events: mergeRests(events) };
                    }),
                };
            }),
        })),
    };
}

/**
 * Deletes just the note under the cursor. Taking the last note out of a chord leaves a rest,
 * tidied in with any rests beside it. The cursor moves to the nearest note left in the chord,
 * or onto the rest. Undefined on a rest, where there's no note to delete.
 */
export function deleteNote(
    composition: Composition,
    cursor: Cursor,
): { composition: Composition; cursor: Cursor } | undefined {
    const { part, measure, voice, leaf } = cursor;
    const event = voiceLeaves(composition, part, measure, voice)[leaf]?.event;
    const events = composition.parts[part]?.measures[measure]?.voices[voice]?.events;
    const deleted = event?.kind === 'chord' ? event.notes[cursor.note] : undefined;
    if (!event || event.kind !== 'chord' || !events || !deleted) return undefined;

    const notes = event.notes.filter((note) => note !== deleted);
    if (notes.length > 0) {
        const edited = withVoiceEvents(
            composition,
            cursor,
            mapLeaves(events, (other, i) => (i === leaf ? { ...event, notes } : other)),
        );
        return { composition: edited, cursor: withNote(edited, cursor, deleted.pitch) };
    }

    const silenced = mapLeaves(events, (other, i) => (i === leaf ? rest(event.duration) : other));
    const edited = withVoiceEvents(composition, cursor, mergeRests(silenced));
    // Merging rests can renumber the leaves, so find the rest by time
    const offset = cursorOffset(composition, cursor);
    return { composition: edited, cursor: cursorAtOffset(edited, part, measure, offset, voice) };
}
