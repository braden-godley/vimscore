/**
 * Reads MuseScore files (`.mscz`, a zip, or the `.mscx` XML inside it) from MuseScore 3 and 4.
 *
 * Each MuseScore staff becomes a part here, playing its MuseScore part's instrument. Notes,
 * rests, tuplets, ties, staccato, arpeggios and voices come across, as do time signatures, key
 * signatures, tempos, repeats and dynamics (as volume markings). What the model has no place
 * for yet, like grace notes, slurs, hairpins, lyrics and voltas, is left out.
 */

import { DOMParser, Element } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import { Composition } from '../composition/Composition';
import { Duration, durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, Tuplet } from '../event/Event';
import { Fraction, ZERO, add, compare, fraction, mul, sub } from '../fraction/Fraction';
import { generalMidiName } from '../instrument/Instrument';
import { KeySignature } from '../key/KeySignature';
import { MeasureInfo, PartMeasure, Tempo, TimeSignature, VolumeMark, measureLength } from '../measure/Measure';
import { Note } from '../note/Note';
import { fromTpc, spell } from '../pitch/Pitch';
import { Clef, Part } from '../part/Part';

const DURATION_TYPES: Record<string, Duration['base']> = {
    whole: 1,
    half: 2,
    quarter: 4,
    eighth: 8,
    '16th': 16,
    '32nd': 32,
    '64th': 64,
};

/** Note values longer or shorter than the model has, in whole notes */
const OTHER_LENGTHS: Record<string, Fraction> = {
    long: fraction(4),
    breve: fraction(2),
    '128th': fraction(1, 128),
};

const GRACE_NOTES = ['acciaccatura', 'appoggiatura', 'grace4', 'grace8after', 'grace16', 'grace16after', 'grace32', 'grace32after'];

const QUARTER: Duration = { base: 4, dots: 0 };

// XML helpers

const children = (element: Element, name?: string): Element[] =>
    Array.from(element.childNodes).filter(
        (node): node is Element => node.nodeType === 1 && (name === undefined || (node as Element).tagName === name),
    );

const child = (element: Element, name: string): Element | undefined => children(element, name)[0];

const text = (element: Element | undefined, name: string): string | undefined =>
    element && child(element, name)?.textContent?.trim();

const number = (element: Element | undefined, name: string): number | undefined => {
    const value = text(element, name);
    return value === undefined || value === '' ? undefined : Number(value);
};

/** `3/4` to a fraction, as MuseScore writes lengths and moves */
function parseFraction(value: string | undefined): Fraction | undefined {
    const match = value && /^(-?\d+)\/(\d+)$/.exec(value);
    return match ? fraction(Number(match[1]), Number(match[2])) : undefined;
}

// Reading the file

/** The `.mscx` text inside a `.mscz`, which is a zip */
function unzipScore(data: Uint8Array): string | undefined {
    const files = unzipSync(data);
    const container = files['META-INF/container.xml'];
    const rootPath = container && /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
    const score = (rootPath && files[rootPath]) ?? Object.entries(files).find(([name]) => name.endsWith('.mscx'))?.[1];
    return score && strFromU8(score);
}

const isZip = (data: Uint8Array) => data[0] === 0x50 && data[1] === 0x4b;

/** The composition in a MuseScore file, or what's wrong with it */
export function readMuseScore(data: Uint8Array): Composition | { error: string } {
    let xml: string | undefined;
    try {
        xml = isZip(data) ? unzipScore(data) : strFromU8(data);
    } catch {
        return { error: "can't unzip it; is it a MuseScore file?" };
    }
    if (!xml) return { error: 'no score inside' };

    const document = new DOMParser().parseFromString(xml, 'text/xml');
    const root = document.documentElement;
    if (!root || root.tagName !== 'museScore') return { error: 'not a MuseScore file' };
    const version = Number(root.getAttribute('version'));
    if (!(version >= 3)) return { error: `MuseScore ${root.getAttribute('version')} files aren't supported, only 3 and 4` };
    const score = child(root, 'Score');
    if (!score) return { error: 'no score in it' };

    try {
        return convertScore(score);
    } catch (error) {
        return { error: (error as Error).message };
    }
}

// Converting

/** A staff's instrument and clef, from the `<Part>` it belongs to */
interface StaffSetup {
    name: string;
    clef: Clef;
    program: number;
    drums: boolean;
}

function clefFromLetter(letter: string | undefined): Clef | undefined {
    if (!letter) return undefined;
    if (letter.startsWith('F')) return 'bass';
    // G, G8vb and so on; alto and tenor clefs aren't in the model, so they read as treble
    return 'treble';
}

/** Every staff id's instrument, name and starting clef */
function readStaffSetups(score: Element): Map<string, StaffSetup> {
    const setups = new Map<string, StaffSetup>();
    for (const part of children(score, 'Part')) {
        const instrument = child(part, 'Instrument');
        const drums = text(instrument, 'useDrumset') === '1';
        const program = Number(instrument && child(child(instrument, 'Channel') ?? instrument, 'program')?.getAttribute('value')) || 0;
        // Named for the instrument, not the part: MuseScore's part names are whatever the author typed
        const name = drums ? 'Drums' : generalMidiName(program);
        // Later MuseScore 3 files say concertClef where earlier ones say clef
        const instrumentClefs = instrument ? [...children(instrument, 'clef'), ...children(instrument, 'concertClef')] : [];

        children(part, 'Staff').forEach((staff, index) => {
            // A piano's second staff names its clef with staff="2"
            const instrumentClef = instrumentClefs.find((clef) => (clef.getAttribute('staff') ?? '1') === String(index + 1));
            const clef =
                clefFromLetter(text(staff, 'defaultClef') ?? text(staff, 'defaultConcertClef')) ??
                clefFromLetter(instrumentClef?.textContent?.trim()) ??
                'treble';
            setups.set(staff.getAttribute('id') ?? '', { name, clef, program, drums });
        });
    }
    return setups;
}

function readTimeSignature(element: Element): TimeSignature | undefined {
    const [beats, beatValue] = [number(element, 'sigN'), number(element, 'sigD')];
    return beats && beatValue ? { beats, beatValue } : undefined;
}

function readKeySignature(element: Element): KeySignature {
    // MuseScore 4 writes concertKey; 3 writes accidental
    const fifths = number(element, 'concertKey') ?? number(element, 'accidental') ?? 0;
    return { fifths: Math.max(-7, Math.min(7, fifths)) };
}

/** MuseScore keeps tempo in quarter notes per second */
function readTempo(element: Element): Tempo | undefined {
    const perSecond = number(element, 'tempo');
    return perSecond ? { bpm: Math.round(perSecond * 60 * 10) / 10, beat: QUARTER } : undefined;
}

/** A chord or rest's written value, or the lengths to split it into when the model has no value for it */
function writtenDuration(element: Element): Duration | Fraction | undefined {
    const type = text(element, 'durationType') ?? '';
    const dots = Math.min(2, number(element, 'dots') ?? 0) as Duration['dots'];
    const base = DURATION_TYPES[type];
    if (base) return { base, dots };
    const length = OTHER_LENGTHS[type];
    return length && mul(length, fraction(2 ** (dots + 1) - 1, 2 ** dots));
}

const isDuration = (value: Duration | Fraction): value is Duration => 'base' in value;

function readNotes(chord: Element): Note[] {
    const staccato = children(chord, 'Articulation').some((articulation) =>
        (text(articulation, 'subtype') ?? '').startsWith('articStaccato'),
    );
    return children(chord, 'Note').map((element) => {
        const sounding = Math.max(0, Math.min(127, number(element, 'pitch') ?? 60));
        // MuseScore spells the note by its tonal pitch class, for concert pitch
        const tpc = number(element, 'tpc');
        const note: Note = { pitch: (tpc !== undefined && fromTpc(tpc, sounding)) || spell(sounding) };
        // A tie is a spanner on its first note, pointing on to the next
        const tie = children(element, 'Spanner').some((spanner) => spanner.getAttribute('type') === 'Tie' && child(spanner, 'next'));
        if (tie) note.tie = true;
        if (staccato) note.staccato = true;
        return note;
    });
}

/** MuseScore's arpeggio subtypes: plain, up, down, bracket, straight up, straight down */
const NON_ARPEGGIO = '3';

/**
 * Whether a chord is rolled. Every kind of arpeggio rolls from the bottom here, even MuseScore's
 * downward ones; the bracket kind means the opposite, play it together, so it isn't one.
 */
function isArpeggio(chord: Element): boolean {
    const arpeggio = child(chord, 'Arpeggio');
    return arpeggio !== undefined && text(arpeggio, 'subtype') !== NON_ARPEGGIO;
}

/** What one `<voice>` element held */
interface VoiceContents {
    events: Event[];
    timeSignature?: TimeSignature;
    keySignature?: KeySignature;
    tempo?: Tempo;
    clef?: Clef;
    volumes: VolumeMark[];
}

function readVoice(voice: Element, length: Fraction): VoiceContents {
    const contents: VoiceContents = { events: [], volumes: [] };
    /** Open tuplets, innermost last; events go into the innermost */
    const tuplets: { tuplet: Tuplet; scale: Fraction }[] = [];
    let position: Fraction = ZERO;

    const current = () => tuplets.at(-1)?.tuplet.events ?? contents.events;
    const scale = () => tuplets.at(-1)?.scale ?? fraction(1);

    const append = (event: Chord | Rest, value: Fraction) => {
        current().push(event);
        position = add(position, mul(value, scale()));
    };

    /** A chord or rest, split into tied pieces if it has a value the model doesn't */
    const place = (make: (duration: Duration, first: boolean, last: boolean) => Chord | Rest, written: Duration | Fraction) => {
        if (isDuration(written)) {
            append(make(written, true, true), fractionOf(written));
            return;
        }
        const pieces = durationsFilling(written);
        pieces.forEach((duration, i) => append(make(duration, i === 0, i === pieces.length - 1), fractionOf(duration)));
    };

    for (const element of children(voice)) {
        switch (element.tagName) {
            case 'TimeSig':
                contents.timeSignature = readTimeSignature(element) ?? contents.timeSignature;
                break;
            case 'KeySig':
                contents.keySignature = readKeySignature(element);
                break;
            case 'Tempo':
                contents.tempo = readTempo(element) ?? contents.tempo;
                break;
            case 'Clef':
                contents.clef = clefFromLetter(text(element, 'concertClefType')) ?? contents.clef;
                break;
            case 'Dynamic': {
                const velocity = number(element, 'velocity');
                if (velocity !== undefined) {
                    contents.volumes.push({ offset: position, percent: Math.round((Math.min(127, velocity) / 127) * 100) });
                }
                break;
            }
            case 'location': {
                // Voices past the first leave gaps; MuseScore moves on over them
                const move = parseFraction(text(element, 'fractions'));
                if (move && compare(move, ZERO) > 0 && tuplets.length === 0) {
                    for (const duration of restsFilling(position, move)) {
                        append({ kind: 'rest', duration }, fractionOf(duration));
                    }
                }
                break;
            }
            case 'Tuplet': {
                const actual = number(element, 'actualNotes') ?? 3;
                const normal = number(element, 'normalNotes') ?? 2;
                const tuplet: Tuplet = { kind: 'tuplet', actual, normal, events: [] };
                current().push(tuplet);
                tuplets.push({ tuplet, scale: mul(scale(), fraction(normal, actual)) });
                break;
            }
            case 'endTuplet':
                tuplets.pop();
                break;
            case 'Rest': {
                const type = text(element, 'durationType');
                if (type === 'measure') {
                    // A whole-measure rest says its length, whatever the time signature
                    const rest = parseFraction(text(element, 'duration')) ?? sub(length, position);
                    for (const duration of durationsFilling(rest)) {
                        append({ kind: 'rest', duration }, fractionOf(duration));
                    }
                    break;
                }
                const written = writtenDuration(element);
                if (written) place((duration) => ({ kind: 'rest', duration }), written);
                break;
            }
            case 'Chord': {
                if (GRACE_NOTES.some((name) => child(element, name))) break;
                const written = writtenDuration(element);
                const notes = readNotes(element);
                if (!written || notes.length === 0) break;
                const arpeggio = isArpeggio(element);
                place(
                    (duration, first, last) => ({
                        kind: 'chord',
                        duration,
                        // Pieces of a split note tie together; the last keeps the note's own tie
                        notes: last ? notes : notes.map(({ pitch }) => ({ pitch, tie: true })),
                        // Only the first piece is struck, so only it rolls
                        ...(arpeggio && first && { arpeggio: true }),
                    }),
                    written,
                );
                break;
            }
        }
    }

    // A voice that stops early is filled out with rests
    if (compare(position, length) < 0) {
        for (const duration of restsFilling(position, sub(length, position))) {
            contents.events.push({ kind: 'rest', duration });
        }
    }
    return contents;
}

const rests = (length: Fraction): Rest[] => durationsFilling(length).map((duration) => ({ kind: 'rest', duration }));

function fractionOf({ base, dots }: Duration): Fraction {
    return fraction(2 ** (dots + 1) - 1, base * 2 ** dots);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function convertScore(score: Element): Composition {
    const setups = readStaffSetups(score);
    const staves = children(score, 'Staff');
    if (staves.length === 0) throw new Error('no staves in it');
    const measureCount = Math.max(...staves.map((staff) => children(staff, 'Measure').length));

    const infos: MeasureInfo[] = [];
    const partMeasures: PartMeasure[][] = staves.map(() => []);
    const clefs: (Clef | undefined)[] = staves.map(() => undefined);
    let timeSignature: TimeSignature = { beats: 4, beatValue: 4 };
    let current: { timeSignature?: TimeSignature; keySignature?: KeySignature; tempo?: Tempo } = {};

    for (let m = 0; m < measureCount; m++) {
        // Changes are on every staff; any staff's will do, the first having them
        const elements = staves.map((staff) => children(staff, 'Measure')[m]);
        for (const measure of elements) {
            for (const voice of measure ? children(measure, 'voice') : []) {
                const signature = child(voice, 'TimeSig');
                if (signature) timeSignature = readTimeSignature(signature) ?? timeSignature;
            }
        }
        // A pickup or other short measure says its own length
        const declared = parseFraction(elements.find((measure) => measure?.getAttribute('len'))?.getAttribute('len') ?? undefined);
        const length = declared ?? measureLength(timeSignature);
        const measureSignature = declared ? { beats: declared.num, beatValue: declared.den } : timeSignature;

        const info: MeasureInfo = {};
        elements.forEach((measure, s) => {
            const voices = (measure ? children(measure, 'voice') : []).map((voice) => readVoice(voice, length));
            // A staff missing the measure gets a measure of rest
            if (voices.length === 0) voices.push({ events: rests(length), volumes: [] });

            for (const voice of voices) {
                if (voice.keySignature && !info.keySignature) info.keySignature = voice.keySignature;
                if (voice.tempo && !info.tempo) info.tempo = voice.tempo;
                if (voice.clef && m === 0 && !clefs[s]) clefs[s] = voice.clef;
            }
            const volumes = voices.flatMap((voice) => voice.volumes).sort((a, b) => compare(a.offset, b.offset));
            partMeasures[s]!.push({
                voices: voices.map(({ events }) => ({ events })),
                ...(volumes.length > 0 && { volumes: dedupeVolumes(volumes) }),
            });
        });

        // Repeat barlines are on every staff's copy of the measure. MuseScore can repeat more
        // than once; here a section always plays twice
        if (elements.some((measure) => measure && child(measure, 'startRepeat'))) info.repeatStart = true;
        if (elements.some((measure) => measure && child(measure, 'endRepeat'))) info.repeatEnd = true;

        // Only what changes is marked, like a printed score
        if (!same(measureSignature, current.timeSignature)) info.timeSignature = measureSignature;
        if (info.keySignature && same(info.keySignature, current.keySignature)) delete info.keySignature;
        if (info.tempo && same(info.tempo, current.tempo)) delete info.tempo;
        current = {
            timeSignature: measureSignature,
            keySignature: info.keySignature ?? current.keySignature,
            tempo: info.tempo ?? current.tempo,
        };
        infos.push(info);
    }

    const parts: Part[] = staves.map((staff, s) => {
        const setup = setups.get(staff.getAttribute('id') ?? '') ?? { name: `Staff ${s + 1}`, clef: 'treble', program: 0, drums: false };
        return {
            name: setup.name,
            clef: clefs[s] ?? setup.clef,
            program: setup.program,
            ...(setup.drums && { bank: 128, drums: true }),
            measures: partMeasures[s]!,
        };
    });

    const title = children(score, 'metaTag').find((tag) => tag.getAttribute('name') === 'workTitle')?.textContent?.trim();
    return { title: title || 'Untitled', measures: infos, parts, soundfont: { filePath: '' } };
}

/** Voices can each carry the same dynamic; one marking at a moment is enough */
function dedupeVolumes(volumes: VolumeMark[]): VolumeMark[] {
    return volumes.filter((mark, i) => i === 0 || compare(mark.offset, volumes[i - 1]!.offset) !== 0);
}
