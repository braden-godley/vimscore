/**
 * The register yanking and deleting fill and putting reads, like vim's unnamed register. It
 * holds either one note, from `yy` and `dd`, or a clip: a stretch of time across some staves.
 * Putting writes over what's there, the way notation is edited, rather than pushing it along.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorAtOffset, cursorOffset, voiceLeaves, withNote } from '../cursor/Cursor';
import { Duration, durationsFilling } from '../duration/Duration';
import { mergeRests, replaceLeaf, withVoiceEvents } from '../edit/Edit';
import { cutIntoMeasures, extractSpan, rests, voiceStream } from '../edit/Stream';
import { Event, mapLeaves } from '../event/Event';
import { Fraction, ZERO, add, compare, fraction, mul, sub } from '../fraction/Fraction';
import { ResolvedMeasure, resolveMeasures } from '../measure/Measure';
import { Note } from '../note/Note';
import { Selection } from '../selection/Selection';
import { comparePitch, midi } from '../pitch/Pitch';

export type Register =
    | { kind: 'note'; note: Note; duration: Duration }
    /**
     * One stream of events per staff, top to bottom, all `length` long. `measures` clips are
     * whole measures and go in at a measure's start, like vim's linewise text.
     */
    | { kind: 'clip'; measures: boolean; length: Fraction; parts: Event[][] };

/** The note under the cursor, with its chord's value. Undefined on a rest */
export function yankNote(composition: Composition, cursor: Cursor): Register | undefined {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    const note = event?.kind === 'chord' ? event.notes[cursor.note] : undefined;
    return event && note ? { kind: 'note', note, duration: event.duration } : undefined;
}

/** What a selection covers, staff by staff. Voice 0 of each, for now */
export function yankSelection(composition: Composition, selection: Selection): Register | undefined {
    const resolved = resolveMeasures(composition.measures);
    const [first, last] =
        selection.kind === 'measures'
            ? [selection.first, selection.last]
            : [selection.start.measure, selection.end.measure];
    const streamStart = resolved[first]?.start;
    const lastMeasure = resolved[last];
    if (!streamStart || !lastMeasure) return undefined;

    const [start, end] =
        selection.kind === 'measures'
            ? [ZERO, sub(add(lastMeasure.start, lastMeasure.length), streamStart)]
            : [timeOf(resolved, selection.start, streamStart), timeOf(resolved, selection.end, streamStart)];

    const parts: Event[][] = [];
    for (let part = selection.firstPart; part <= selection.lastPart; part++) {
        const span = extractSpan(voiceStream(composition, part, first, last), start, end);
        if (!span) return undefined;
        parts.push(span);
    }
    return { kind: 'clip', measures: selection.kind === 'measures', length: sub(end, start), parts };
}

function timeOf(resolved: ResolvedMeasure[], { measure, offset }: { measure: number; offset: Fraction }, from: Fraction) {
    return sub(add(resolved[measure]!.start, offset), from);
}

/**
 * Puts the register at the cursor. A note joins the chord under the cursor, or takes the place
 * of a rest. A clip goes in from the cursor's beat (`after`: from the end of its chord), or for
 * whole measures from the start of the cursor's measure (`after`: the next one), `count` times
 * over. Undefined when it can't: the note is already there, or the clip would cut a tuplet.
 */
export function put(
    composition: Composition,
    cursor: Cursor,
    register: Register,
    after: boolean,
    count = 1,
): { composition: Composition; cursor: Cursor } | undefined {
    return register.kind === 'note'
        ? putNote(composition, cursor, register)
        : putClip(composition, cursor, register, after, count);
}

function putNote(
    composition: Composition,
    cursor: Cursor,
    { note, duration }: Extract<Register, { kind: 'note' }>,
): { composition: Composition; cursor: Cursor } | undefined {
    const event = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf]?.event;
    if (!event) return undefined;

    let edited: Composition | undefined;
    if (event.kind === 'rest') {
        edited = replaceLeaf(composition, cursor, { kind: 'chord', duration, notes: [note] });
    } else if (!event.notes.some(({ pitch }) => midi(pitch) === midi(note.pitch))) {
        const notes = [...event.notes, note].sort((a, b) => comparePitch(a.pitch, b.pitch));
        const events = composition.parts[cursor.part]!.measures[cursor.measure]!.voices[cursor.voice]!.events;
        const joined = mapLeaves(events, (other, i) => (i === cursor.leaf ? { ...event, notes } : other));
        edited = withVoiceEvents(composition, cursor, joined);
    }
    return edited && { composition: edited, cursor: withNote(edited, cursor, note.pitch) };
}

/** Adds empty measures, like the last one, until the composition reaches `end` */
function extendTo(composition: Composition, end: Fraction): Composition {
    let extended = composition;
    for (;;) {
        const resolved = resolveMeasures(extended.measures);
        const last = resolved.at(-1);
        if (!last || compare(add(last.start, last.length), end) >= 0) return extended;
        const empty = mergeRests(rests(durationsFilling(last.length)));
        extended = {
            ...extended,
            measures: [...extended.measures, {}],
            parts: extended.parts.map((part) => ({ ...part, measures: [...part.measures, { voices: [{ events: empty }] }] })),
        };
    }
}

function putClip(
    composition: Composition,
    cursor: Cursor,
    clip: Extract<Register, { kind: 'clip' }>,
    after: boolean,
    count: number,
): { composition: Composition; cursor: Cursor } | undefined {
    const resolved = resolveMeasures(composition.measures);
    const here = resolved[cursor.measure];
    if (!here) return undefined;

    let at: Fraction;
    if (clip.measures) {
        at = after ? add(here.start, here.length) : here.start;
    } else {
        const offset = cursorOffset(composition, cursor);
        const leaf = voiceLeaves(composition, cursor.part, cursor.measure, cursor.voice)[cursor.leaf];
        at = add(here.start, after && leaf ? add(offset, leaf.length) : offset);
    }
    const length = mul(clip.length, fraction(count));
    const end = add(at, length);

    let edited = extendTo(composition, end);
    const measures = resolveMeasures(edited.measures);
    const first = measures.findIndex((m) => compare(add(m.start, m.length), at) > 0);
    let last = first;
    while (measures[last + 1] && compare(measures[last + 1]!.start, end) < 0) last++;
    const streamStart = measures[first]!.start;
    const streamLength = sub(add(measures[last]!.start, measures[last]!.length), streamStart);
    const from = sub(at, streamStart);

    for (const [k, clipEvents] of clip.parts.entries()) {
        const part = cursor.part + k;
        if (part >= edited.parts.length) break;

        const stream = voiceStream(edited, part, first, last);
        const before = extractSpan(stream, ZERO, from, true);
        const rest = extractSpan(stream, add(from, length), streamLength, true);
        if (!before || !rest) return undefined;
        const pasted = Array.from({ length: count }, () => clipEvents).flat();

        const cut = cutIntoMeasures([...before, ...pasted, ...rest], (i) => measures[first + i]!.length, true);
        if (!cut || cut.length !== last - first + 1) return undefined;
        cut.forEach((events, i) => {
            edited = withVoiceEvents(edited, { part, measure: first + i, voice: 0, leaf: 0, note: 0 }, events);
        });
    }

    const landing = measures[first]!;
    return { composition: edited, cursor: cursorAtOffset(edited, cursor.part, first, sub(at, landing.start)) };
}
