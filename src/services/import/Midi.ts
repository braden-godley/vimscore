/**
 * Reads Standard MIDI Files (`.mid`, `.midi`), types 0 and 1.
 *
 * A MIDI file says when each note starts and stops, in ticks, not how it's written, so the
 * notes are fitted to a grid and written out. Each beat takes the grid that fits the notes
 * starting in it best: sixteenths, triplets (written as 3:2 tuplets) or thirty-seconds. Notes
 * that overlap go in separate voices, up to four; past that, a note is cut short where the next
 * one starts.
 *
 * Each channel of each track becomes a part, playing the channel's instrument, and a channel
 * that changes instrument becomes a part for each one. Channel 10 is drums. Tempos, time
 * signatures and keys come across at the start of the measure they fall in; channel volumes
 * become the mixer's, and velocities become a dynamic at the start of any measure where the
 * part gets a dynamic louder or softer. Everything else, like pitch bends, pedals and lyrics, is left out.
 */

import { Composition } from '../composition/Composition';
import { Duration, durationsFilling, notesFilling, restsFilling } from '../duration/Duration';
import { DEFAULT_DYNAMIC, DYNAMIC_STEP, Dynamic, dynamicVelocity, nearestDynamic } from '../dynamic/Dynamic';
import { Chord, Event, Rest } from '../event/Event';
import { fraction } from '../fraction/Fraction';
import { generalMidiName } from '../instrument/Instrument';
import { KeySignature } from '../key/KeySignature';
import { DEFAULT_TIME_SIGNATURE, DynamicMark, MeasureInfo, PartMeasure, TimeSignature, Voice } from '../measure/Measure';
import { Clef } from '../clef/Clef';
import { Part } from '../part/Part';
import { spell } from '../pitch/Pitch';

// Reading the file

export interface MidiNote {
    track: number;
    channel: number;
    /** The program the channel was playing when the note started */
    program: number;
    /** The channel's volume (controller 7) when the note started, if it was set */
    volume?: number;
    pitch: number;
    velocity: number;
    start: number;
    end: number;
}

export interface Timed<T> {
    tick: number;
    value: T;
}

/**
 * Notes as they're played, timed in ticks: what a MIDI file holds, and what other formats that
 * only say when notes sound, like Organya's, are read into to be written out the same way
 */
export interface MidiFile {
    format: number;
    ticksPerQuarter: number;
    notes: MidiNote[];
    /** Microseconds a quarter note */
    tempos: Timed<number>[];
    timeSignatures: Timed<TimeSignature>[];
    keys: Timed<KeySignature>[];
    /** Each track's name, if it has one */
    names: (string | undefined)[];
    /** Where the music ends, when it's known: nothing plays from there */
    end?: number;
    /** A stretch played over again, marked with repeat barlines where it starts and ends on one */
    loop?: { start: number; end: number };
}

export const DRUM_CHANNEL = 9;
const VOLUME_CONTROLLER = 7;
/** Bytes of data after each kind of channel message, by its high four bits */
const DATA_BYTES: Record<number, number> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 };

class Damaged extends Error {}

/** Reads the chunks and events, pairing each note on with its note off */
function parseMidi(data: Uint8Array): MidiFile {
    let at = 0;
    const need = (count: number) => {
        if (at + count > data.length) throw new Damaged();
    };
    const byte = () => {
        need(1);
        return data[at++]!;
    };
    const uint = (count: number) => {
        let value = 0;
        for (let i = 0; i < count; i++) value = value * 256 + byte();
        return value;
    };
    const text = (start: number, length: number) => new TextDecoder('latin1').decode(data.subarray(start, start + length));
    const variable = () => {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const next = byte();
            value = value * 128 + (next & 0x7f);
            if (next < 0x80) return value;
        }
        throw new Damaged();
    };

    if (text(0, 4) !== 'MThd') throw new Damaged('Not a MIDI file');
    at = 4;
    const headerLength = uint(4);
    const format = uint(2);
    const trackCount = uint(2);
    const division = uint(2);
    if (division & 0x8000) throw new Damaged('Timed in SMPTE frames rather than beats, which vimscore can\'t read');
    if (format > 1) throw new Damaged('A type 2 MIDI file, of separate songs, which vimscore can\'t read');
    if (division === 0) throw new Damaged();
    at = 8 + headerLength;

    const file: MidiFile = { format, ticksPerQuarter: division, notes: [], tempos: [], timeSignatures: [], keys: [], names: [] };
    for (let track = 0; track < trackCount && at < data.length; track++) {
        need(8);
        const kind = text(at, 4);
        at += 4;
        const length = uint(4);
        const end = Math.min(data.length, at + length);
        // Chunks that aren't tracks are skipped, as the format asks
        if (kind !== 'MTrk') {
            at = end;
            track--;
            continue;
        }

        let tick = 0;
        let running = 0;
        const programs = new Map<number, number>();
        const volumes = new Map<number, number>();
        /** Notes sounding, by channel and pitch, first started first */
        const sounding = new Map<number, Omit<MidiNote, 'end'>[]>();
        while (at < end) {
            tick += variable();
            let status = byte();
            if (status === 0xff) {
                const type = byte();
                const size = variable();
                need(size);
                const start = at;
                at += size;
                if (type === 0x03 && file.names[track] === undefined) file.names[track] = text(start, size).trim() || undefined;
                if (type === 0x51 && size === 3) file.tempos.push({ tick, value: (data[start]! << 16) | (data[start + 1]! << 8) | data[start + 2]! });
                if (type === 0x58 && size >= 2) {
                    const beats = data[start]!;
                    const beatValue = 2 ** data[start + 1]!;
                    if (beats > 0 && beatValue <= 64) file.timeSignatures.push({ tick, value: { beats, beatValue } });
                }
                if (type === 0x59 && size >= 1) {
                    const fifths = (data[start]! << 24) >> 24;
                    if (Math.abs(fifths) <= 7) file.keys.push({ tick, value: { fifths } });
                }
                if (type === 0x2f) break;
                continue;
            }
            if (status === 0xf0 || status === 0xf7) {
                at += variable();
                continue;
            }
            if (status < 0x80) {
                // Running status: the last status again, and this was its first data byte
                if (!running) throw new Damaged();
                status = running;
                at--;
            }
            running = status;
            const command = status & 0xf0;
            const channel = status & 0x0f;
            need(DATA_BYTES[command]!);
            const first = data[at]!;
            const second = DATA_BYTES[command] === 2 ? data[at + 1]! : 0;
            at += DATA_BYTES[command]!;

            const key = channel * 128 + first;
            if (command === 0x90 && second > 0) {
                const note = { track, channel, program: programs.get(channel) ?? 0, pitch: first, velocity: second, start: tick };
                const volume = volumes.get(channel);
                sounding.set(key, [...(sounding.get(key) ?? []), volume === undefined ? note : { ...note, volume }]);
            } else if (command === 0x80 || command === 0x90) {
                const started = sounding.get(key)?.shift();
                if (started) file.notes.push({ ...started, end: tick });
            } else if (command === 0xc0) {
                programs.set(channel, first);
            } else if (command === 0xb0 && first === VOLUME_CONTROLLER) {
                volumes.set(channel, second);
            }
        }
        // Notes never stopped stop when the track does
        for (const started of [...sounding.values()].flat()) file.notes.push({ ...started, end: tick });
        at = end;
    }
    return file;
}

// Fitting the notes to measures and beats

/** Times from here on are in these, so sixteenths, triplets and 64ths all come out whole */
const UNITS_PER_WHOLE = 192;
const UNITS_PER_QUARTER = UNITS_PER_WHOLE / 4;
const SIXTEENTH = 12;
const TRIPLET_SIXTEENTH = 8;
const THIRTY_SECOND = 6;
/**
 * Notes are often let go a little before the line they're held to, more for longer notes. An
 * end up to this share of the note's length before a line reaches it; otherwise one just past a
 * line, by up to this share of the grid, is held to that line, and one up to this share of the
 * grid before the next reaches that.
 */
const EARLY_RELEASE = 0.08;
const LATE_RELEASE = 0.25;
const RELEASE_REACH = 0.6;

const units = (length: number) => fraction(length, UNITS_PER_WHOLE);

interface Measure {
    start: number;
    length: number;
    timeSignature: TimeSignature;
    info: MeasureInfo;
    key: KeySignature;
    /** Compound time, like 6/8, already has three to a beat, so it never needs triplets */
    compound: boolean;
    /** The beat notes are written to, in units: a quarter, or a dotted quarter in 6/8 */
    beat: number;
}

/** A stretch of a measure, a quarter long or what's left at the end, and the grid its notes are on */
interface Window {
    start: number;
    end: number;
    grid: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The measures, long enough to hold `until`, with each change on the first one it falls in */
function layMeasures(file: MidiFile, until: number, toUnits: (tick: number) => number): Measure[] {
    const byTime = <T>(list: Timed<T>[]) => [...list].sort((a, b) => a.tick - b.tick);
    const timeSignatures = byTime(file.timeSignatures);
    const tempos = byTime(file.tempos);
    const keys = byTime(file.keys);

    const measures: Measure[] = [];
    let timeSignature = DEFAULT_TIME_SIGNATURE;
    let key: KeySignature = { fifths: 0 };
    let next = { time: 0, tempo: 0, key: 0 };
    let start = 0;
    while (measures.length === 0 || start < until) {
        const info: MeasureInfo = {};
        // A change partway through a measure waits for the next one
        while (next.time < timeSignatures.length && toUnits(timeSignatures[next.time]!.tick) <= start) {
            const changed = timeSignatures[next.time++]!.value;
            if (!same(changed, timeSignature) || measures.length === 0) timeSignature = changed;
        }
        if (measures.length === 0 ? !same(timeSignature, DEFAULT_TIME_SIGNATURE) : !same(timeSignature, measures.at(-1)!.timeSignature)) {
            info.timeSignature = timeSignature;
        }
        const length = (timeSignature.beats * UNITS_PER_WHOLE) / timeSignature.beatValue;
        while (next.tempo < tempos.length && toUnits(tempos[next.tempo]!.tick) < start + length) {
            info.tempo = { bpm: Math.round(60_000_000 / tempos[next.tempo++]!.value), beat: { base: 4, dots: 0 } };
        }
        while (next.key < keys.length && toUnits(keys[next.key]!.tick) < start + length) {
            const changed = keys[next.key++]!.value;
            if (changed.fifths !== key.fifths) info.keySignature = key = changed;
        }
        const compound = timeSignature.beatValue >= 8 && timeSignature.beats % 3 === 0;
        const beat = ((compound ? 3 : 1) * UNITS_PER_WHOLE) / timeSignature.beatValue;
        measures.push({ start, length, timeSignature, info, key, compound, beat });
        start += length;
    }
    return measures;
}

/** How far a time is from the nearest line of a grid, from the window's start */
const gridError = (offset: number, grid: number) => Math.abs(offset - Math.round(offset / grid) * grid);

/**
 * The grid for a window, from where notes start in it: the coarsest that has every start close
 * to a line, or the one closest overall. Triplets only fit a whole beat of simple time.
 */
function chooseGrid(offsets: number[], length: number, compound: boolean): number {
    const grids = length === UNITS_PER_QUARTER && !compound ? [SIXTEENTH, TRIPLET_SIXTEENTH, THIRTY_SECOND] : [SIXTEENTH, THIRTY_SECOND];
    const fitting = grids.find((grid) => offsets.every((offset) => gridError(offset, grid) <= grid / 4));
    if (fitting) return fitting;
    const total = (grid: number) => offsets.reduce((sum, offset) => sum + gridError(offset, grid), 0);
    return grids.reduce((best, grid) => (total(grid) < total(best) ? grid : best));
}

function windowsOf(measures: Measure[]): Omit<Window, 'grid'>[] {
    return measures.flatMap(({ start, length }) =>
        Array.from({ length: Math.ceil(length / UNITS_PER_QUARTER) }, (_, i) => ({
            start: start + i * UNITS_PER_QUARTER,
            end: Math.min(start + length, start + (i + 1) * UNITS_PER_QUARTER),
        })),
    );
}

/** Which of a list sorted by start is the last starting at or before `time`; the first if none */
function lastStarting(list: { start: number }[], time: number): number {
    let low = 0;
    let high = list.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (list[middle]!.start <= time) low = middle;
        else high = middle - 1;
    }
    return low;
}

const windowAt = (windows: Window[], time: number) => windows[lastStarting(windows, time)]!;

function snap(windows: Window[], time: number): number {
    const window = windowAt(windows, time);
    const snapped = window.start + Math.round((time - window.start) / window.grid) * window.grid;
    return Math.max(window.start, Math.min(window.end, snapped));
}

/** Where a note `length` long ending at `time` is held to; see RELEASE_REACH */
function snapEnd(windows: Window[], time: number, length: number): number {
    const { start, end, grid } = windowAt(windows, time);
    const offset = time - start;
    const below = Math.floor(offset / grid) * grid;
    if (offset === below) return start + below;
    const toNext = below + grid - offset;
    const reaches = toNext <= length * EARLY_RELEASE || (offset - below > grid * LATE_RELEASE && toNext <= grid * RELEASE_REACH);
    return Math.min(end, start + (reaches ? below + grid : below));
}

// Voices

interface Span {
    start: number;
    end: number;
    pitches: number[];
}

const MAX_VOICES = 4;

/**
 * Chords of notes that start and stop together, in voices that never overlap: each goes in the
 * first voice free when it starts, higher chords first, so the top line tends to be voice 1
 */
function intoVoices(notes: { pitch: number; start: number; end: number }[]): Span[][] {
    const chords = new Map<string, Span>();
    for (const { pitch, start, end } of notes) {
        const key = `${start}:${end}`;
        const chord = chords.get(key);
        if (chord) chord.pitches.push(pitch);
        else chords.set(key, { start, end, pitches: [pitch] });
    }
    const ordered = [...chords.values()].sort((a, b) => a.start - b.start || Math.max(...b.pitches) - Math.max(...a.pitches));

    const voices: Span[][] = [];
    const endOf = (voice: Span[]) => voice.at(-1)?.end ?? 0;
    for (const chord of ordered) {
        const free = voices.find((voice) => endOf(voice) <= chord.start);
        if (free) free.push(chord);
        else if (voices.length < MAX_VOICES) voices.push([chord]);
        else {
            // Every voice is busy: the one free soonest gives way
            const voice = voices.reduce((soonest, other) => (endOf(other) < endOf(soonest) ? other : soonest));
            const last = voice.at(-1)!;
            if (last.start === chord.start) last.pitches.push(...chord.pitches.filter((pitch) => !last.pitches.includes(pitch)));
            else {
                last.end = chord.start;
                voice.push(chord);
            }
        }
    }
    return voices;
}

// Writing it out

/**
 * One voice's events in one measure. Beats on the triplet grid where the voice has notes off
 * the sixteenth grid are written as triplets; the rest is written as plain values, notes tied
 * across beats and barlines as they need.
 */
function writeVoice(spans: Span[], measure: Measure, windows: Window[], spell: (pitch: number) => Chord['notes'][number]): Event[] {
    const start = measure.start;
    const end = measure.start + measure.length;
    const inside = spans.filter((span) => span.end > start && span.start < end);
    if (inside.length === 0) return durationsFilling(units(measure.length)).map((duration): Rest => ({ kind: 'rest', duration }));

    // The measure as back-to-back stretches of chords and rests
    const stretches: { start: number; end: number; span?: Span }[] = [];
    let at = start;
    for (const span of inside) {
        const from = Math.max(start, span.start);
        if (from > at) stretches.push({ start: at, end: from });
        stretches.push({ start: from, end: Math.min(end, span.end), span });
        at = Math.min(end, span.end);
    }
    if (at < end) stretches.push({ start: at, end });

    // Runs of plain beats are written together; a triplet beat on its own
    const mine = windows.filter((window) => window.start >= start && window.end <= end);
    const isTriplet = (window: Window) =>
        window.grid === TRIPLET_SIXTEENTH &&
        stretches.some(({ start: s, end: e }) =>
            [s, e].some((time) => time > window.start && time < window.end && (time - window.start) % SIXTEENTH !== 0),
        );
    const regions: { start: number; end: number; triplet: boolean }[] = [];
    for (const window of mine) {
        const triplet = isTriplet(window);
        const last = regions.at(-1);
        if (last && !last.triplet && !triplet) last.end = window.end;
        else regions.push({ start: window.start, end: window.end, triplet });
    }

    // A chord's notes tie on to its next piece, up to its last
    const piece = (stretch: (typeof stretches)[number], to: number, durations: Duration[]): (Chord | Rest)[] =>
        durations.map((duration, i) => {
            if (!stretch.span) return { kind: 'rest', duration };
            const last = i === durations.length - 1 && to >= stretch.span.end;
            const notes = stretch.span.pitches
                .slice()
                .sort((a, b) => a - b)
                .map((pitch) => (last ? spell(pitch) : { ...spell(pitch), tie: true }));
            return { kind: 'chord', duration, notes };
        });

    const events: Event[] = [];
    for (const region of regions) {
        const inner: Event[] = [];
        for (const stretch of stretches) {
            const from = Math.max(region.start, stretch.start);
            const to = Math.min(region.end, stretch.end);
            if (from >= to) continue;
            // Inside a triplet, everything is written half as long again
            const scale = region.triplet ? 1.5 : 1;
            const offset = region.triplet ? (from - region.start) * scale : from - start;
            const length = units((to - from) * scale);
            // Inside a triplet the beat is its eighths
            const beat = units(region.triplet ? UNITS_PER_WHOLE / 8 : measure.beat);
            // Rests in compound time keep its dotted beats clear too
            const beatwise = stretch.span || (measure.compound && !region.triplet);
            const values = beatwise ? notesFilling(units(offset), length, beat) : restsFilling(units(offset), length);
            inner.push(...piece(stretch, to, values));
        }
        if (region.triplet) events.push({ kind: 'tuplet', actual: 3, normal: 2, events: inner });
        else events.push(...inner);
    }
    return events;
}

/** The dynamic for each measure where it changes, from the middle velocity of its notes */
function dynamicsOf(notes: MidiNote[], measures: Measure[], measureOf: (time: number) => number, toUnits: (tick: number) => number) {
    const velocities = new Map<number, number[]>();
    for (const note of notes) {
        const m = measureOf(toUnits(note.start));
        const list = velocities.get(m);
        if (list) list.push(note.velocity);
        else velocities.set(m, [note.velocity]);
    }
    const marks = new Map<number, DynamicMark[]>();
    let current: Dynamic = DEFAULT_DYNAMIC;
    for (let m = 0; m < measures.length; m++) {
        const list = velocities.get(m)?.sort((a, b) => a - b);
        if (!list) continue;
        // Only a change of a whole dynamic or more, so accents don't flip it back and forth
        const middle = list[Math.floor(list.length / 2)]!;
        const dynamic = nearestDynamic(middle);
        if (dynamic === current || Math.abs(middle - dynamicVelocity(current)) < DYNAMIC_STEP) continue;
        marks.set(m, [{ offset: fraction(0), dynamic }]);
        current = dynamic;
    }
    return marks;
}

export function readMidi(data: Uint8Array): Composition | { error: string } {
    let file: MidiFile;
    try {
        file = parseMidi(data);
    } catch (error) {
        return { error: error instanceof Damaged && error.message ? error.message : 'Not a MIDI file, or a damaged one' };
    }
    if (file.notes.length === 0) return { error: 'No notes in it' };
    return writeOut(file);
}

/** Writes notes as they're played out as a score, as the top of this file describes */
export function writeOut(file: MidiFile): Composition {
    const toUnits = (tick: number) => (tick * UNITS_PER_QUARTER) / file.ticksPerQuarter;
    const lastEnd = file.end === undefined ? Math.max(...file.notes.map((note) => toUnits(note.end))) : toUnits(file.end);
    const measures = layMeasures(file, lastEnd, toUnits);
    if (file.loop) {
        // Only on barlines, where repeat barlines can go
        const first = measures.findIndex(({ start }) => start === toUnits(file.loop!.start));
        const after = measures.findIndex(({ start }) => start === toUnits(file.loop!.end));
        const last = after === -1 && toUnits(file.loop.end) === measures.at(-1)!.start + measures.at(-1)!.length ? measures.length - 1 : after - 1;
        if (first !== -1 && last >= first) {
            measures[first]!.info.repeatStart = true;
            measures[last]!.info.repeatEnd = true;
        }
    }
    const measureOf = (time: number) => lastStarting(measures, time);
    const plainWindows = windowsOf(measures);
    // Nothing snaps past the last barline
    const measureEnd = measures.at(-1)!.start + measures.at(-1)!.length;

    // A part for each track, channel and instrument, in that order
    const groups = new Map<string, MidiNote[]>();
    for (const note of file.notes) {
        const drums = note.channel === DRUM_CHANNEL;
        const key = `${note.track}:${note.channel}:${drums ? 'drums' : note.program}`;
        const group = groups.get(key);
        if (group) group.push(note);
        else groups.set(key, [note]);
    }
    const ordered = [...groups.values()].sort(
        (a, b) => a[0]!.track - b[0]!.track || a[0]!.channel - b[0]!.channel || a[0]!.start - b[0]!.start,
    );
    const partsInTrack = (track: number) => ordered.filter((notes) => notes[0]!.track === track).length;

    const names = new Map<string, number>();
    const parts: Part[] = ordered.map((notes) => {
        const { track, channel, program, volume } = notes[0]!;
        const drums = channel === DRUM_CHANNEL;

        // The grid for each beat, from where this part's notes start in it
        const offsets = new Map<number, number[]>();
        for (const note of notes) {
            const time = toUnits(note.start);
            const w = lastStarting(plainWindows, time);
            offsets.set(w, [...(offsets.get(w) ?? []), time - plainWindows[w]!.start]);
        }
        const windows: Window[] = plainWindows.map((window, w) => ({
            ...window,
            grid: chooseGrid(offsets.get(w) ?? [], window.end - window.start, measures[measureOf(window.start)]!.compound),
        }));

        // Snapped to the grid, a note at least one line long; the same pitch again cuts it short
        const snapped = notes
            .map(({ pitch, start, end }) => {
                const from = Math.min(measureEnd, snap(windows, toUnits(start)));
                let to = Math.min(measureEnd, snapEnd(windows, toUnits(end), toUnits(end) - toUnits(start)));
                if (to <= from) to = Math.min(measureEnd, from + windowAt(windows, from).grid);
                return { pitch, start: from, end: to };
            })
            .filter(({ start, end }) => end > start)
            .sort((a, b) => a.pitch - b.pitch || a.start - b.start || b.end - a.end);
        const kept: typeof snapped = [];
        for (const note of snapped) {
            const previous = kept.at(-1);
            if (previous && previous.pitch === note.pitch && note.start < previous.end) {
                if (note.start === previous.start) continue;
                previous.end = note.start;
            }
            kept.push(note);
        }
        const voices = intoVoices(kept);

        const spellIn = (key: KeySignature) => (pitch: number) => ({ pitch: drums ? spell(pitch) : spell(pitch, key) });
        const dynamics = dynamicsOf(notes, measures, measureOf, toUnits);
        const partMeasures: PartMeasure[] = measures.map((measure, m) => {
            const written = voices.map((voice) => writeVoice(voice, measure, windows, spellIn(measure.key)));
            const used = written.map((_, v) => voices[v]!.some((span) => span.end > measure.start && span.start < measure.start + measure.length));
            const count = Math.max(1, used.lastIndexOf(true) + 1);
            const measureVoices: Voice[] = written.slice(0, count).map((events) => ({ events }));
            if (measureVoices.length === 0) measureVoices.push({ events: writeVoice([], measure, windows, spellIn(measure.key)) });
            const marks = dynamics.get(m);
            return { voices: measureVoices, ...(marks && { dynamics: marks }) };
        });

        const pitches = kept.map(({ pitch }) => pitch).sort((a, b) => a - b);
        const middle = pitches[Math.floor(pitches.length / 2)] ?? 60;
        const clef: Clef = drums ? 'percussion' : middle < 60 ? 'bass' : 'treble';
        // A named track with one part is called by its name, others by their instrument
        const trackName = file.names[track];
        const base = (trackName && partsInTrack(track) === 1 && (file.format === 1 || ordered.length === 1) && trackName) || (drums ? 'Drums' : generalMidiName(program));
        const seen = (names.get(base) ?? 0) + 1;
        names.set(base, seen);
        const name = seen > 1 ? `${base} ${seen}` : base;
        return {
            name,
            clef,
            program: drums ? 0 : program,
            ...(drums && { bank: 128, drums: true }),
            ...(volume !== undefined && volume !== 100 && { volume }),
            measures: partMeasures,
        };
    });

    // A type 1 file's first track holds the title when it has no notes of its own
    const titleTrack = file.format === 0 || !file.notes.some((note) => note.track === 0) ? file.names[0] : undefined;
    return {
        title: titleTrack || 'Untitled',
        measures: measures.map(({ info }) => info),
        parts,
        soundfonts: [],
    };
}
