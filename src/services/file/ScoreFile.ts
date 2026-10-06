/**
 * The save file: a composition as JSON, with its format and version so later versions can tell
 * what they're reading. It's written to be read too: values are short strings like `q.` and
 * `3/4`, and each event sits on its own line.
 *
 *     { "chord": ["C4", "Eb4", { "pitch": "G4", "tie": true }], "duration": "q" }
 *     { "rest": "8." }
 *     { "tuplet": "3:2", "events": [...] }
 */

import { Composition } from '../composition/Composition';
import { Duration } from '../duration/Duration';
import { Chord, Event } from '../event/Event';
import { Fraction, fraction } from '../fraction/Fraction';
import { Hairpin, MeasureInfo, PartMeasure, Tempo, TimeSignature, VolumeMark } from '../measure/Measure';
import { C_MAJOR, KeySignature } from '../key/KeySignature';
import { Note } from '../note/Note';
import { Clef, Part } from '../part/Part';
import { Pitch, parsePitch, pitchName, spell } from '../pitch/Pitch';

export const FORMAT = 'vimscore';
/** Version 2 spells pitches like `Bb4`; version 1 had MIDI numbers, which it reads in the key */
export const VERSION = 2;
export const EXTENSION = 'vimscore';

const DURATION_CODES: Record<Duration['base'], string> = {
    1: 'w',
    2: 'h',
    4: 'q',
    8: '8',
    16: '16',
    32: '32',
    64: '64',
};
const CODE_BASES = new Map(
    Object.entries(DURATION_CODES).map(([base, code]) => [code, Number(base) as Duration['base']]),
);
const CLEFS: Clef[] = ['treble', 'bass'];

const durationText = ({ base, dots }: Duration) => DURATION_CODES[base] + '.'.repeat(dots);

const fractionText = ({ num, den }: Fraction) => `${num}/${den}`;

// Writing

function noteData({ pitch, tie, staccato }: Note): unknown {
    const name = pitchName(pitch);
    return tie || staccato ? { pitch: name, ...(tie && { tie }), ...(staccato && { staccato }) } : name;
}

function eventData(event: Event): unknown {
    switch (event.kind) {
        case 'chord':
            return {
                chord: event.notes.map(noteData),
                duration: durationText(event.duration),
                ...(event.arpeggio && { arpeggio: true }),
            };
        case 'rest':
            return { rest: durationText(event.duration) };
        case 'tuplet':
            return { tuplet: `${event.actual}:${event.normal}`, events: event.events.map(eventData) };
    }
}

function measureInfoData({ timeSignature, tempo, keySignature, repeatStart, repeatEnd }: MeasureInfo): unknown {
    return {
        ...(timeSignature && { timeSignature: `${timeSignature.beats}/${timeSignature.beatValue}` }),
        ...(tempo && { tempo: `${durationText(tempo.beat)}=${tempo.bpm}` }),
        ...(keySignature && { key: keySignature.fifths }),
        ...(repeatStart && { repeatStart }),
        ...(repeatEnd && { repeatEnd }),
    };
}

/** How many levels of lists and objects a value has inside it */
function depth(value: unknown): number {
    if (value === null || typeof value !== 'object') return 0;
    return 1 + Math.max(0, ...Object.values(value).map(depth));
}

/** One line of JSON with a space after each comma and colon, like `{ "rest": "q" }` */
function inline(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
    const fields = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`);
    return `{ ${fields.join(', ')} }`;
}

/**
 * JSON indented by structure: lists one item per line, and small objects (an event, a
 * measure's changes) on one line each.
 */
function pretty(value: unknown, indent = ''): string {
    const inner = indent + '  ';
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return `[\n${value.map((item) => inner + pretty(item, inner)).join(',\n')}\n${indent}]`;
    }
    if (value === null || typeof value !== 'object' || depth(value) <= 3) return inline(value);
    const fields = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`);
    return `{\n${fields.join(',\n')}\n${indent}}`;
}

export function writeScore(composition: Composition): string {
    const data = {
        format: FORMAT,
        version: VERSION,
        title: composition.title,
        ...(composition.soundfont.filePath && { soundfont: composition.soundfont.filePath }),
        measures: composition.measures.map(measureInfoData),
        parts: composition.parts.map(({ name, clef, program, bank, drums, measures }) => ({
            name,
            ...(clef && { clef }),
            program,
            ...(bank && { bank }),
            ...(drums && { drums }),
            measures: measures.map(({ voices, volumes, hairpins }) => ({
                voices: voices.map(({ events }) => events.map(eventData)),
                ...(volumes?.length && {
                    volume: volumes.map(({ offset, percent }) => ({ at: fractionText(offset), percent })),
                }),
                ...(hairpins?.length && {
                    hairpin: hairpins.map(({ offset, length, kind, percent }) => ({
                        at: fractionText(offset),
                        length: fractionText(length),
                        kind,
                        ...(percent !== undefined && { percent }),
                    })),
                }),
            })),
        })),
    };
    return pretty(data) + '\n';
}

// Reading

/** Why a file couldn't be read, and where in it */
class ReadError extends Error {}

type Path = string;

function fail(path: Path, message: string): never {
    throw new ReadError(path ? `${path}: ${message}` : message);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function object(value: unknown, path: Path): Record<string, unknown> {
    return isObject(value) ? value : fail(path, 'expected an object');
}

function array(value: unknown, path: Path): unknown[] {
    return Array.isArray(value) ? value : fail(path, 'expected a list');
}

function string(value: unknown, path: Path): string {
    return typeof value === 'string' ? value : fail(path, 'expected text');
}

function integer(value: unknown, path: Path, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        fail(path, `expected a whole number from ${min} to ${max}`);
    }
    return value;
}

function readDuration(value: unknown, path: Path): Duration {
    const text = string(value, path);
    const match = /^(w|h|q|8|16|32|64)(\.{0,2})$/.exec(text);
    if (!match) fail(path, `"${text}" isn't a note value like q, 8 or h.`);
    return { base: CODE_BASES.get(match[1]!)!, dots: match[2]!.length as Duration['dots'] };
}

/** A name like `Bb4`, or from an older file a MIDI number, spelled the key's way */
function readPitch(value: unknown, path: Path, key: KeySignature): Pitch {
    if (typeof value === 'number') return spell(integer(value, path, 0, 127), key);
    const name = string(value, path);
    return parsePitch(name) ?? fail(path, `"${name}" isn't a pitch like C4, F#3 or Bb5`);
}

function readNote(value: unknown, path: Path, key: KeySignature): Note {
    if (!isObject(value)) return { pitch: readPitch(value, path, key) };
    const data = value;
    const note: Note = { pitch: readPitch(data['pitch'], `${path}.pitch`, key) };
    if (data['tie'] === true) note.tie = true;
    if (data['staccato'] === true) note.staccato = true;
    return note;
}

function readEvent(value: unknown, path: Path, key: KeySignature): Event {
    const data = object(value, path);
    if ('chord' in data) {
        const notes = array(data['chord'], `${path}.chord`).map((note, i) => readNote(note, `${path}.chord[${i}]`, key));
        if (notes.length === 0) fail(`${path}.chord`, 'a chord needs at least one note');
        const chord: Chord = { kind: 'chord', notes, duration: readDuration(data['duration'], `${path}.duration`) };
        if (data['arpeggio'] === true) chord.arpeggio = true;
        return chord;
    }
    if ('rest' in data) return { kind: 'rest', duration: readDuration(data['rest'], `${path}.rest`) };
    if ('tuplet' in data) {
        const ratio = string(data['tuplet'], `${path}.tuplet`);
        const match = /^(\d+):(\d+)$/.exec(ratio);
        if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) {
            fail(`${path}.tuplet`, `"${ratio}" isn't a ratio like 3:2`);
        }
        const events = array(data['events'], `${path}.events`).map((event, i) => readEvent(event, `${path}.events[${i}]`, key));
        return { kind: 'tuplet', actual: Number(match[1]), normal: Number(match[2]), events };
    }
    return fail(path, 'expected a chord, rest or tuplet');
}

function readTimeSignature(value: unknown, path: Path): TimeSignature {
    const text = string(value, path);
    const match = /^(\d+)\/(1|2|4|8|16|32|64)$/.exec(text);
    if (!match || Number(match[1]) < 1) fail(path, `"${text}" isn't a time signature like 3/4`);
    return { beats: Number(match[1]), beatValue: Number(match[2]) };
}

function readTempo(value: unknown, path: Path): Tempo {
    const text = string(value, path);
    const [beat, bpm, ...extra] = text.split('=');
    const beats = Number(bpm);
    if (extra.length > 0 || !(beats > 0)) fail(path, `"${text}" isn't a tempo like q=120`);
    return { beat: readDuration(beat, path), bpm: beats };
}

function readMeasureInfo(value: unknown, path: Path): MeasureInfo {
    const data = object(value, path);
    const info: MeasureInfo = {};
    if (data['timeSignature'] !== undefined) {
        info.timeSignature = readTimeSignature(data['timeSignature'], `${path}.timeSignature`);
    }
    if (data['tempo'] !== undefined) info.tempo = readTempo(data['tempo'], `${path}.tempo`);
    if (data['key'] !== undefined) info.keySignature = { fifths: integer(data['key'], `${path}.key`, -7, 7) };
    if (data['repeatStart'] === true) info.repeatStart = true;
    if (data['repeatEnd'] === true) info.repeatEnd = true;
    return info;
}

function readFraction(value: unknown, path: Path, what: string): Fraction {
    const text = string(value, path);
    const match = /^(\d+)\/(\d+)$/.exec(text);
    if (!match || Number(match[2]) === 0) fail(path, `"${text}" isn't ${what}, like 1/4`);
    return fraction(Number(match[1]), Number(match[2]));
}

function readVolumeMark(value: unknown, path: Path): VolumeMark {
    const data = object(value, path);
    return {
        offset: readFraction(data['at'], `${path}.at`, 'a time in the measure'),
        percent: integer(data['percent'], `${path}.percent`, 0, 100),
    };
}

const HAIRPIN_KINDS: Hairpin['kind'][] = ['crescendo', 'diminuendo'];

function readHairpin(value: unknown, path: Path): Hairpin {
    const data = object(value, path);
    const kind = string(data['kind'], `${path}.kind`);
    if (!HAIRPIN_KINDS.includes(kind as Hairpin['kind'])) {
        fail(`${path}.kind`, `"${kind}" isn't a hairpin (${HAIRPIN_KINDS.join(' or ')})`);
    }
    const hairpin: Hairpin = {
        offset: readFraction(data['at'], `${path}.at`, 'a time in the measure'),
        length: readFraction(data['length'], `${path}.length`, 'a length in whole notes'),
        kind: kind as Hairpin['kind'],
    };
    if (data['percent'] !== undefined) hairpin.percent = integer(data['percent'], `${path}.percent`, 0, 100);
    return hairpin;
}

function readPartMeasure(value: unknown, path: Path, key: KeySignature): PartMeasure {
    const data = object(value, path);
    const voices = array(data['voices'], `${path}.voices`);
    const partMeasure: PartMeasure = {
        voices: voices.map((voice, v) => ({
            events: array(voice, `${path}.voices[${v}]`).map((event, i) => readEvent(event, `${path}.voices[${v}][${i}]`, key)),
        })),
    };
    if (data['volume'] !== undefined) {
        const marks = array(data['volume'], `${path}.volume`);
        partMeasure.volumes = marks.map((mark, i) => readVolumeMark(mark, `${path}.volume[${i}]`));
    }
    if (data['hairpin'] !== undefined) {
        const hairpins = array(data['hairpin'], `${path}.hairpin`);
        partMeasure.hairpins = hairpins.map((hairpin, i) => readHairpin(hairpin, `${path}.hairpin[${i}]`));
    }
    return partMeasure;
}

/** `keys` is the key signature in force in each measure */
function readPart(value: unknown, path: Path, keys: KeySignature[]): Part {
    const data = object(value, path);
    const part: Part = {
        name: string(data['name'], `${path}.name`),
        program: integer(data['program'] ?? 0, `${path}.program`, 0, 127),
        measures: array(data['measures'], `${path}.measures`).map((m, i) => readPartMeasure(m, `${path}.measures[${i}]`, keys[i] ?? C_MAJOR)),
    };
    if (data['bank'] !== undefined) part.bank = integer(data['bank'], `${path}.bank`, 0, 16383);
    if (data['drums'] === true) part.drums = true;
    if (data['clef'] !== undefined) {
        const clef = string(data['clef'], `${path}.clef`);
        if (!CLEFS.includes(clef as Clef)) fail(`${path}.clef`, `"${clef}" isn't a clef (${CLEFS.join(' or ')})`);
        part.clef = clef as Clef;
    }
    if (part.measures.length !== keys.length) {
        fail(`${path}.measures`, `has ${part.measures.length} measures but the score has ${keys.length}`);
    }
    return part;
}

/** The composition in a save file, or what's wrong with the file */
export function readScore(text: string): Composition | { error: string } {
    try {
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch (error) {
            return fail('', `not valid JSON (${(error as Error).message})`);
        }

        const data = object(json, '');
        if (data['format'] !== FORMAT) fail('', `not a ${FORMAT} file`);
        const version = data['version'];
        if (typeof version !== 'number' || version > VERSION) {
            fail('version', `this file is version ${String(version)}; this app reads up to version ${VERSION}`);
        }

        const measures = array(data['measures'], 'measures').map((m, i) => readMeasureInfo(m, `measures[${i}]`));
        let key = C_MAJOR;
        const keys = measures.map((info) => (key = info.keySignature ?? key));
        return {
            title: data['title'] === undefined ? 'Untitled' : string(data['title'], 'title'),
            measures,
            parts: array(data['parts'], 'parts').map((part, i) => readPart(part, `parts[${i}]`, keys)),
            soundfont: { filePath: data['soundfont'] === undefined ? '' : string(data['soundfont'], 'soundfont') },
        };
    } catch (error) {
        if (error instanceof ReadError) return { error: error.message };
        throw error;
    }
}
