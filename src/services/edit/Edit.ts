/**
 * Changes to a composition. Each takes the composition and returns a new one, leaving the
 * original untouched, so the editor can hand edits back like any other result.
 */

import { Composition } from '../composition/Composition';
import { Cursor, clampCursor, cursorAtOffset, cursorOffset, cursorPitch, leafAtOffset, voiceLeaves, withNote } from '../cursor/Cursor';
import { Duration, durationValue, durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, Tuplet, eventsLength, mapLeaves } from '../event/Event';
import { Fraction, ZERO, add, compare, fraction, mul, sub } from '../fraction/Fraction';
import { ResolvedMeasure, beatLength, resolveMeasures } from '../measure/Measure';
import { Note } from '../note/Note';
import { Phantom } from '../phantom/Phantom';
import { comparePitch, midi, samePitch, transpose } from '../pitch/Pitch';
import { LeafRef, Selection, selectedLeaves } from '../selection/Selection';

/**
 * Moves every note in the selection by `semitones`, spelled as `transpose` does. If that would
 * take any note out of MIDI's range, nothing moves, so chords keep their shape.
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
                        const notes = event.notes.map((note) => {
                            const pitch = transpose(note.pitch, semitones);
                            if (!pitch) outOfRange = true;
                            return { ...note, pitch: pitch ?? note.pitch };
                        });
                        return { ...event, notes };
                    }),
                })),
            };
        }),
    }));

    return outOfRange ? composition : { ...composition, parts };
}

const leafKey = ({ part, measure, voice, leaf }: LeafRef) => `${part}-${measure}-${voice}-${leaf}`;

/** Rewrites the chords among `refs`, given each one's ref, sharing measures with none of them */
function mapChords<R extends LeafRef>(composition: Composition, refs: R[], fn: (chord: Chord, ref: R) => Chord): Composition {
    const byKey = new Map(refs.map((ref) => [leafKey(ref), ref]));
    const parts = composition.parts.map((part, p) => ({
        ...part,
        measures: part.measures.map((partMeasure, m) => {
            if (!refs.some((ref) => ref.part === p && ref.measure === m)) return partMeasure;
            return {
                ...partMeasure,
                voices: partMeasure.voices.map((voice, v) => ({
                    ...voice,
                    events: mapLeaves(voice.events, (event, leaf) => {
                        const ref = byKey.get(leafKey({ part: p, measure: m, voice: v, leaf }));
                        return event.kind === 'chord' && ref ? fn(event, ref) : event;
                    }),
                })),
            };
        }),
    }));
    return { ...composition, parts };
}

/**
 * Rolls the chords among `refs` as arpeggios, or if every one already is, plays them straight
 * again. Rests are skipped. Undefined when there's no chord to change.
 */
export function toggleArpeggios(composition: Composition, refs: LeafRef[]): Composition | undefined {
    const chords = refs.flatMap(({ part, measure, voice, leaf }) => {
        const event = voiceLeaves(composition, part, measure, voice)[leaf]?.event;
        return event?.kind === 'chord' ? [event] : [];
    });
    if (chords.length === 0) return undefined;
    const arpeggio = !chords.every((chord) => chord.arpeggio);

    return mapChords(composition, refs, (event) => {
        const { arpeggio: _, ...straight } = event;
        return arpeggio ? { ...straight, arpeggio } : straight;
    });
}

/**
 * Has the notes among `refs` slide on to the next chord, or if every one already does, stops
 * them. A ref with a `note` is just that note; one without, every note of its chord. Rests are
 * skipped. Undefined when there's no note to change.
 */
export function toggleGlissandi(composition: Composition, refs: (LeafRef & { note?: number })[]): Composition | undefined {
    const picks = (ref: LeafRef & { note?: number }, index: number) => ref.note === undefined || ref.note === index;
    const notes = refs.flatMap((ref) => {
        const event = voiceLeaves(composition, ref.part, ref.measure, ref.voice)[ref.leaf]?.event;
        return event?.kind === 'chord' ? event.notes.filter((_, i) => picks(ref, i)) : [];
    });
    if (notes.length === 0) return undefined;
    const glissando = !notes.every((note) => note.glissando);

    return mapChords(composition, refs, (event, ref) => ({
        ...event,
        notes: event.notes.map((note, i) => {
            if (!picks(ref, i)) return note;
            const { glissando: _, ...straight } = note;
            return glissando ? { ...straight, glissando } : straight;
        }),
    }));
}

/**
 * Makes every note of the chords among `refs` staccato, or if every one already is, plays them
 * full length again. The whole chord, since it's drawn with one dot. Rests are skipped.
 * Undefined when there's no chord to change.
 */
export function toggleStaccatos(composition: Composition, refs: LeafRef[]): Composition | undefined {
    const notes = refs.flatMap(({ part, measure, voice, leaf }) => {
        const event = voiceLeaves(composition, part, measure, voice)[leaf]?.event;
        return event?.kind === 'chord' ? event.notes : [];
    });
    if (notes.length === 0) return undefined;
    const staccato = !notes.every((note) => note.staccato);

    return mapChords(composition, refs, (event) => ({
        ...event,
        notes: event.notes.map((note) => {
            const { staccato: _, ...held } = note;
            return staccato ? { ...held, staccato } : held;
        }),
    }));
}

/**
 * Ties the notes among `refs` to the same pitch in the next chord, or if every one already is,
 * unties them. A ref with a `note` is just that note; one without, every note of its chord.
 * Rests are skipped. Undefined when there's no note to change.
 */
export function toggleTies(composition: Composition, refs: (LeafRef & { note?: number })[]): Composition | undefined {
    const picks = (ref: LeafRef & { note?: number }, index: number) => ref.note === undefined || ref.note === index;
    const notes = refs.flatMap((ref) => {
        const event = voiceLeaves(composition, ref.part, ref.measure, ref.voice)[ref.leaf]?.event;
        return event?.kind === 'chord' ? event.notes.filter((_, i) => picks(ref, i)) : [];
    });
    if (notes.length === 0) return undefined;
    const tie = !notes.every((note) => note.tie);

    return mapChords(composition, refs, (event, ref) => ({
        ...event,
        notes: event.notes.map((note, i) => {
            if (!picks(ref, i)) return note;
            const { tie: _, ...untied } = note;
            return tie ? { ...untied, tie } : untied;
        }),
    }));
}

/** Swaps in new events for the cursor's voice in its measure, sharing everything else */
export function withVoiceEvents(composition: Composition, { part, measure, voice }: Cursor, events: Event[]): Composition {
    const replace = <T>(list: T[], index: number, fn: (item: T) => T) => list.map((item, i) => (i === index ? fn(item) : item));
    return {
        ...composition,
        parts: replace(composition.parts, part, (p) => ({
            ...p,
            measures: replace(p.measures, measure, (m) => ({
                ...m,
                // A voice the measure doesn't have yet is added
                voices:
                    voice < m.voices.length
                        ? replace(m.voices, voice, (v) => ({ ...v, events }))
                        : [...m.voices, { events }],
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
 * Puts a chord or rest in place of the cursor's, writing over what follows or leaving rests if
 * its value changed (see `overwrite`). Undefined if it doesn't fit.
 */
export function replaceLeaf(composition: Composition, cursor: Cursor, replacement: Chord | Rest): Composition | undefined {
    const events = composition.parts[cursor.part]?.measures[cursor.measure]?.voices[cursor.voice]?.events;
    const measureLength = resolveMeasures(composition.measures)[cursor.measure]?.length;
    if (!events || !measureLength) return undefined;

    const newEvents = rewriteAroundLeaf(events, cursor.leaf, (list, index, inTuplet) =>
        overwrite(list, index, replacement, inTuplet ? eventsLength(list) : measureLength),
    );
    return newEvents && withVoiceEvents(composition, cursor, newEvents);
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
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    if (!event) return undefined;

    const notes = event.kind === 'chord' ? event.notes : [];
    const existing = notes.find(({ pitch }) => midi(pitch) === midi(phantom.pitch));
    const others = notes.filter((note) => note !== existing);
    // A rolled chord stays rolled as notes come and go
    const rolled = event.kind === 'chord' && event.arpeggio && { arpeggio: true };

    let replacement: Chord | Rest;
    if (
        existing &&
        samePitch(existing.pitch, phantom.pitch) &&
        sameDuration(event.duration, phantom.duration) &&
        !!existing.staccato === phantom.staccato
    ) {
        replacement =
            others.length > 0
                ? { kind: 'chord', duration: event.duration, notes: others, ...rolled }
                : { kind: 'rest', duration: event.duration };
    } else {
        // Keeps a tie the note already had, taking the phantom's spelling
        const { staccato: _, ...kept }: Note = { ...existing, pitch: phantom.pitch };
        const placed: Note = phantom.staccato ? { ...kept, staccato: true } : kept;
        const sorted = [...others, placed].sort((a, b) => comparePitch(a.pitch, b.pitch));
        replacement = { kind: 'chord', duration: phantom.duration, notes: sorted, ...rolled };
    }

    const edited = replaceLeaf(composition, cursor, replacement);
    if (!edited) return undefined;
    const placed =
        replacement.kind === 'chord' && replacement.notes.some(({ pitch }) => samePitch(pitch, phantom.pitch))
            ? replacement
            : undefined;
    return { composition: edited, cursor: withNote(edited, clampCursor(edited, cursor), phantom.pitch), placed };
}

/**
 * Moves the cursor's note by `semitones`, spelled as `transpose` does, keeping the chord sorted
 * by pitch and the cursor on the note that moved. Undefined on a rest, past MIDI's range, or
 * onto a pitch the chord already has.
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

    const pitch = transpose(moving.pitch, semitones);
    if (!pitch) return undefined;
    if (event.notes.some((note) => note !== moving && midi(note.pitch) === midi(pitch))) return undefined;

    const moved = { ...moving, pitch };
    const notes = event.notes
        .map((note) => (note === moving ? moved : note))
        .sort((a, b) => comparePitch(a.pitch, b.pitch));
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
export function mergeRests(list: Event[], top = true): Event[] {
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

/**
 * Gives the cursor's chord (every note in it) or rest a new value, with no dots. A longer value
 * writes over what follows; a shorter one leaves rests. Undefined if it doesn't fit before the
 * end of the measure or tuplet, or nothing would change.
 */
export function setLeafDuration(composition: Composition, cursor: Cursor, duration: Duration): Composition | undefined {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    if (!event || sameDuration(event.duration, duration)) return undefined;
    return replaceLeaf(composition, cursor, { ...event, duration });
}

/**
 * How many of the notes a tuplet of `actual` replaces, the way they're usually written: three in
 * the time of two, four in the time of three, five, six or seven in the time of four
 */
export const TUPLET_NORMALS: Record<number, number> = { 3: 2, 4: 3, 5: 4, 6: 4, 7: 4 };

/**
 * Turns the cursor's chord or rest into a tuplet of `actual` taking the same time (see
 * `TUPLET_NORMALS`): it becomes the first of them, with rests after it to fill in. Each is the
 * old value divided by the tuplet's normal count, so a dotted value stays dotted, except in the
 * time of three, which needs a dotted value to divide. Undefined when there's nothing there, or
 * that value can't be written.
 */
export function makeTuplet(composition: Composition, cursor: Cursor, actual: number): Composition | undefined {
    const events = composition.parts[cursor.part]?.measures[cursor.measure]?.voices[cursor.voice]?.events;
    const normal = TUPLET_NORMALS[actual];
    if (!events || !normal) return undefined;

    const newEvents = rewriteAroundLeaf(events, cursor.leaf, (list, index) => {
        const event = list[index] as Chord | Rest;
        let durations: Duration[];
        try {
            durations = durationsFilling(mul(durationValue(event.duration), fraction(1, normal)));
        } catch {
            return undefined;
        }
        const [duration] = durations;
        if (!duration || durations.length > 1) return undefined;
        const rests = Array.from({ length: actual - 1 }, () => rest(duration));
        const tuplet: Tuplet = { kind: 'tuplet', actual, normal, events: [{ ...event, duration }, ...rests] };
        return list.map((other, i) => (i === index ? tuplet : other));
    });
    return newEvents && withVoiceEvents(composition, cursor, newEvents);
}

/**
 * Puts a rest of `duration` in place of the cursor's chord or rest, writing over what follows
 * or leaving rests like placing a note does. Undefined if it doesn't fit.
 */
export function placeRest(
    composition: Composition,
    cursor: Cursor,
    duration: Duration,
): { composition: Composition; cursor: Cursor } | undefined {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    if (!event) return undefined;
    if (event.kind === 'rest' && sameDuration(event.duration, duration)) return { composition, cursor };
    const edited = replaceLeaf(composition, cursor, { kind: 'rest', duration });
    return edited && { composition: edited, cursor: clampCursor(edited, { ...cursor, note: 0 }) };
}

/**
 * Insert mode's beat motion: `delta` beats on through the cursor's voice, or back, across
 * barlines. It lands on the chord or rest sounding on the beat, passing beats the cursor's own
 * chord is held over. A rest across the beat is split there, so a note can go on it, unless
 * it's in a tuplet. Stops at the first or last beat of the part.
 */
export function moveBeat(composition: Composition, cursor: Cursor, delta: number): { composition: Composition; cursor: Cursor } {
    const measures = resolveMeasures(composition.measures);
    let moved = { composition, cursor };
    for (let remaining = Math.abs(delta); remaining > 0; remaining--) {
        const next = beatStep(moved.composition, measures, moved.cursor, Math.sign(delta));
        if (!next) break;
        moved = next;
    }
    const followed = cursorPitch(composition, cursor) ?? 'top';
    return { composition: moved.composition, cursor: withNote(moved.composition, moved.cursor, followed) };
}

function beatStep(
    composition: Composition,
    measures: ResolvedMeasure[],
    cursor: Cursor,
    step: number,
): { composition: Composition; cursor: Cursor } | undefined {
    const { part, voice } = cursor;
    const hasLeaves = (measure: number) => voiceLeaves(composition, part, measure, voice).length > 0;
    const nearestMeasure = (from: number) => {
        let measure = from;
        while (measure >= 0 && measure < measures.length && !hasLeaves(measure)) measure += step;
        return measure >= 0 && measure < measures.length ? measure : undefined;
    };

    let measure = cursor.measure;
    let start = cursorOffset(composition, cursor);
    if (step < 0 && compare(start, ZERO) === 0) {
        const previous = nearestMeasure(measure - 1);
        if (previous === undefined) return undefined;
        measure = previous;
        start = measures[measure]!.length;
    }

    const { timeSignature, length } = measures[measure]!;
    const beat = beatLength(timeSignature);
    // How many beats into the measure the cursor's chord or rest starts
    const beats = (start.num * beat.den) / (start.den * beat.num);
    const leafList = voiceLeaves(composition, part, measure, voice);

    if (step < 0) {
        const target = mul(beat, fraction(Math.ceil(beats) - 1));
        return landOnBeat(composition, { ...cursor, measure }, leafAtOffset(leafList, target), target);
    }

    for (let target = mul(beat, fraction(Math.floor(beats) + 1)); compare(target, length) < 0; target = add(target, beat)) {
        const leaf = leafAtOffset(leafList, target);
        if (leaf !== cursor.leaf) return landOnBeat(composition, cursor, leaf, target);
        const split = splitRest(composition, cursor, sub(target, start));
        if (split) return split;
    }
    const next = nearestMeasure(measure + 1);
    return next === undefined ? undefined : { composition, cursor: { ...cursor, measure: next, leaf: 0 } };
}

/** Puts the cursor on `leaf`, splitting it at `beat` if it's a rest that starts before */
function landOnBeat(composition: Composition, cursor: Cursor, leaf: number, beat: Fraction) {
    const landed = { ...cursor, leaf };
    const leafStart = cursorOffset(composition, landed);
    if (compare(leafStart, beat) === 0) return { composition, cursor: landed };
    return splitRest(composition, landed, sub(beat, leafStart)) ?? { composition, cursor: landed };
}

/**
 * Splits the cursor's rest `before` whole notes in, into rests laid out on the beat, and moves
 * the cursor to the part after. Undefined on a chord, or a rest in a tuplet.
 */
function splitRest(composition: Composition, cursor: Cursor, before: Fraction): { composition: Composition; cursor: Cursor } | undefined {
    const events = composition.parts[cursor.part]?.measures[cursor.measure]?.voices[cursor.voice]?.events;
    if (!events) return undefined;
    let leading = 0;
    const newEvents = rewriteAroundLeaf(events, cursor.leaf, (list, index, inTuplet) => {
        const event = list[index];
        if (inTuplet || event?.kind !== 'rest') return undefined;
        const start = eventsLength(list.slice(0, index));
        const split = add(start, before);
        try {
            const first = restsFilling(start, before);
            const second = restsFilling(split, sub(add(start, durationValue(event.duration)), split));
            leading = first.length;
            return [...list.slice(0, index), ...[...first, ...second].map(rest), ...list.slice(index + 1)];
        } catch {
            return undefined;
        }
    });
    if (!newEvents) return undefined;
    return { composition: withVoiceEvents(composition, cursor, newEvents), cursor: { ...cursor, leaf: cursor.leaf + leading, note: 0 } };
}
