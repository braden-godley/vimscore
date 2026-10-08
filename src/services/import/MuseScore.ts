/**
 * Reads MuseScore files (`.mscz`, a zip, or the `.mscx` XML inside it) from MuseScore 3 and 4.
 *
 * Each MuseScore staff becomes a part here, playing its MuseScore part's instrument. Notes,
 * rests, tuplets, ties, slurs, articulations (staccato, tenuto, accent, marcato), arpeggios,
 * glissandi and voices come across, as do time signatures, key signatures, tempos, repeats, dynamics
 * (anything past ppp or ff as those), hairpins, and the mixer's volumes: MuseScore 3's channel
 * volumes, or MuseScore 4's audio settings. What the model has no
 * place for yet, like grace notes, lyrics and voltas, is left out.
 */

import { DOMParser, Element } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import { Composition } from '../composition/Composition';
import { Duration, durationsFilling, restsFilling } from '../duration/Duration';
import { Chord, Event, Rest, Tuplet, leaves } from '../event/Event';
import { Fraction, ZERO, add, compare, fraction, mul, sub } from '../fraction/Fraction';
import { Dynamic, isDynamic, nearestDynamic } from '../dynamic/Dynamic';
import { generalMidiName } from '../instrument/Instrument';
import { MAX_MASTER_VOLUME, MAX_PART_VOLUME, NORMAL_MIX } from '../edit/Mixer';
import { KeySignature } from '../key/KeySignature';
import {
    Hairpin,
    HairpinKind,
    MeasureInfo,
    PartMeasure,
    Tempo,
    TimeSignature,
    DynamicMark,
    measureLength,
} from '../measure/Measure';
import { Articulation, Note, notePiece, withArticulation } from '../note/Note';
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

/** The `.mscx` text inside a `.mscz`, which is a zip, and MuseScore 4's mixer settings beside it */
function unzipScore(data: Uint8Array): { xml?: string; audioSettings?: string } {
    const files = unzipSync(data);
    const container = files['META-INF/container.xml'];
    const rootPath = container && /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
    const score = (rootPath && files[rootPath]) ?? Object.entries(files).find(([name]) => name.endsWith('.mscx'))?.[1];
    const audioSettings = files['audiosettings.json'];
    return { xml: score && strFromU8(score), audioSettings: audioSettings && strFromU8(audioSettings) };
}

const isZip = (data: Uint8Array) => data[0] === 0x50 && data[1] === 0x4b;

/** The composition in a MuseScore file, or what's wrong with it */
export function readMuseScore(data: Uint8Array): Composition | { error: string } {
    let xml: string | undefined;
    let audioSettings: string | undefined;
    try {
        ({ xml, audioSettings } = isZip(data) ? unzipScore(data) : { xml: strFromU8(data) });
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
        return withMixer(convertScore(score), score, audioSettings);
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
    /** Its `<Part>`'s id in MuseScore 4, or its place among them in MuseScore 3 */
    partId: string;
    /** The mixer's volume, from MuseScore 3's channel volume */
    volume?: number;
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
    children(score, 'Part').forEach((part, partIndex) => {
        const instrument = child(part, 'Instrument');
        const drums = text(instrument, 'useDrumset') === '1';
        const channel = instrument && child(instrument, 'Channel');
        const program = Number(instrument && child(channel ?? instrument, 'program')?.getAttribute('value')) || 0;
        const partId = part.getAttribute('id') || String(partIndex);
        const volume = channel && channelMix(channel);
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
            const setup = { name, clef, program, drums, partId, ...(volume !== undefined && { volume }) };
            setups.set(staff.getAttribute('id') ?? '', setup);
        });
    });
    return setups;
}

/**
 * The mixer's volume in a MuseScore 3 `<Channel>`: its channel volume, which is ours as it is,
 * or nothing when muted. Undefined when it's normal.
 */
function channelMix(channel: Element): number | undefined {
    if (text(channel, 'mute') === '1') return 0;
    const controller = children(channel, 'controller').find((element) => element.getAttribute('ctrl') === '7');
    const value = Number(controller?.getAttribute('value'));
    return controller && Number.isFinite(value) && value !== NORMAL_MIX ? Math.max(0, Math.min(MAX_PART_VOLUME, value)) : undefined;
}

/** MuseScore 4's mixer track: its volume in decibels and whether it's muted */
interface AudioOutput {
    volumeDb?: number;
    muted?: boolean;
}

/**
 * MuseScore 4's mixer in decibels as our volume, where a channel volume's loudness goes with
 * its square: 40 log10(percent / 100) dB
 */
function decibelsMix({ volumeDb = 0, muted }: AudioOutput, max: number): number {
    return muted ? 0 : Math.max(0, Math.min(max, Math.round(100 * 10 ** (volumeDb / 40))));
}

/**
 * Sets each part's volume and the master volume from MuseScore's mixer: MuseScore 4's audio
 * settings when the file has them, or MuseScore 3's channel volumes
 */
function withMixer(composition: Composition, score: Element, audioSettings: string | undefined): Composition {
    const setups = readStaffSetups(score);
    let tracks = new Map<string, AudioOutput>();
    let master: AudioOutput | undefined;
    try {
        const settings = audioSettings ? JSON.parse(audioSettings) : undefined;
        tracks = new Map(
            (settings?.tracks ?? []).map((track: { partId?: unknown; out?: AudioOutput }) => [String(track.partId), track.out ?? {}]),
        );
        master = settings?.master;
    } catch {
        // A mixer that can't be read leaves the volumes normal
    }

    const parts = composition.parts.map((part, s) => {
        // Staves line up with parts, as `convertScore` makes them
        const setup = setups.get(children(score, 'Staff')[s]?.getAttribute('id') ?? '');
        const track = setup && tracks.get(setup.partId);
        const volume = track ? decibelsMix(track, MAX_PART_VOLUME) : setup?.volume;
        return volume === undefined || volume === NORMAL_MIX ? part : { ...part, volume };
    });
    const volume = master && decibelsMix(master, MAX_MASTER_VOLUME);
    return { ...composition, parts, ...(volume !== undefined && volume !== NORMAL_MIX && { volume }) };
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

/** The words in MuseScore's articulation names, like `articAccentStaccatoAbove`, that we have */
const ARTICULATION_WORDS: Record<string, Articulation> = {
    Staccato: 'staccato',
    // Played short like a staccato, which is as near as the model gets
    Staccatissimo: 'staccato',
    Tenuto: 'tenuto',
    Accent: 'accent',
    Marcato: 'marcato',
};

/**
 * The articulations on a chord. MuseScore names each mark for the symbols in it, some holding
 * two, like `articTenutoStaccatoBelow`; ones the model has no place for are left out.
 */
function readArticulations(chord: Element): Articulation[] {
    return children(chord, 'Articulation').flatMap((articulation) => {
        const name = /^artic(.*?)(Above|Below)?$/.exec(text(articulation, 'subtype') ?? '')?.[1] ?? '';
        return (name.match(/[A-Z][a-z]*/g) ?? []).flatMap((word) => ARTICULATION_WORDS[word] ?? []);
    });
}

function readNotes(chord: Element): Note[] {
    const articulations = readArticulations(chord);
    return children(chord, 'Note').map((element) => {
        const sounding = Math.max(0, Math.min(127, number(element, 'pitch') ?? 60));
        // MuseScore spells the note by its tonal pitch class, for concert pitch
        const tpc = number(element, 'tpc');
        let note: Note = { pitch: (tpc !== undefined && fromTpc(tpc, sounding)) || spell(sounding) };
        // A tie or glissando is a spanner on its first note, pointing on to the next
        const startsSpanner = (type: string) =>
            children(element, 'Spanner').some((spanner) => spanner.getAttribute('type') === type && child(spanner, 'next'));
        if (startsSpanner('Tie')) note.tie = true;
        if (startsSpanner('Glissando')) note.glissando = true;
        for (const articulation of articulations) note = withArticulation(note, articulation, true);
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

/**
 * A dynamic by its name, like `mf`. Louder than ff or softer than ppp is taken as those, and
 * any other, like `sfz`, as the nearest to its velocity, if it has one
 */
function readDynamic(element: Element): Dynamic | undefined {
    const name = text(element, 'subtype') ?? '';
    if (isDynamic(name)) return name;
    if (/^p+$/.test(name)) return 'ppp';
    if (/^f+$/.test(name)) return 'ff';
    const velocity = number(element, 'velocity');
    return velocity === undefined ? undefined : nearestDynamic(velocity);
}

/**
 * MuseScore's hairpin subtypes: the crescendo and diminuendo wedges, then the same as `cresc.`
 * and `dim.` lines
 */
const HAIRPIN_KINDS: HairpinKind[] = ['crescendo', 'diminuendo', 'crescendo', 'diminuendo'];

/**
 * Where a hairpin starts, and where it ends relative to that: `measures` on, then `fractions`
 * from the same place in that measure, as MuseScore writes it
 */
interface HairpinStart {
    offset: Fraction;
    kind: HairpinKind;
    measures: number;
    fractions: Fraction;
}

/** A hairpin's start, from the spanner MuseScore writes there; its end is a spanner pointing back */
function readHairpin(spanner: Element, offset: Fraction): HairpinStart | undefined {
    const hairpin = spanner.getAttribute('type') === 'HairPin' ? child(spanner, 'HairPin') : undefined;
    const next = child(spanner, 'next');
    const location = next && child(next, 'location');
    if (!hairpin || !location) return undefined;
    const kind = HAIRPIN_KINDS[number(hairpin, 'subtype') ?? 0];
    if (!kind) return undefined;
    return { offset, kind, measures: number(location, 'measures') ?? 0, fractions: parseFraction(text(location, 'fractions')) ?? ZERO };
}

/** Where a slur starts in its measure, and where it ends relative to that, as for a hairpin */
interface SlurStart {
    offset: Fraction;
    measures: number;
    fractions: Fraction;
}

/**
 * A slur's start, from the spanner MuseScore writes in the chord it starts on (or just before
 * it); its end is a spanner pointing back
 */
function readSlur(spanner: Element, offset: Fraction): SlurStart | undefined {
    const next = spanner.getAttribute('type') === 'Slur' ? child(spanner, 'next') : undefined;
    const location = next && child(next, 'location');
    if (!location) return undefined;
    return { offset, measures: number(location, 'measures') ?? 0, fractions: parseFraction(text(location, 'fractions')) ?? ZERO };
}

/** What one `<voice>` element held */
interface VoiceContents {
    events: Event[];
    timeSignature?: TimeSignature;
    keySignature?: KeySignature;
    tempo?: Tempo;
    clef?: Clef;
    dynamics: DynamicMark[];
    hairpins: HairpinStart[];
    slurs: SlurStart[];
}

function readVoice(voice: Element, length: Fraction): VoiceContents {
    const contents: VoiceContents = { events: [], dynamics: [], hairpins: [], slurs: [] };
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
                const dynamic = readDynamic(element);
                if (dynamic) contents.dynamics.push({ offset: position, dynamic });
                break;
            }
            case 'Spanner': {
                const hairpin = readHairpin(element, position);
                if (hairpin) contents.hairpins.push(hairpin);
                const slur = readSlur(element, position);
                if (slur) contents.slurs.push(slur);
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
                for (const spanner of children(element, 'Spanner')) {
                    const slur = readSlur(spanner, position);
                    if (slur) contents.slurs.push(slur);
                }
                const arpeggio = isArpeggio(element);
                place(
                    (duration, first, last) => ({
                        kind: 'chord',
                        duration,
                        // Pieces of a split note tie together; the last keeps the note's own tie
                        // and the first its accent or marcato
                        notes: notes.map((note) => notePiece(note, first, last)),
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
    /** Each staff's hairpins by the measure they start in, placed once every measure's start is known */
    const hairpinStarts: HairpinStart[][][] = staves.map(() => []);
    /** Each staff's slurs by the measure they start in, likewise */
    const slurStarts: (SlurStart & { voice: number })[][][] = staves.map(() => []);
    /** Where each measure starts, in whole notes, and finally where the last one ends */
    const measureStarts: Fraction[] = [ZERO];
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
            if (voices.length === 0) voices.push({ events: rests(length), dynamics: [], hairpins: [], slurs: [] });

            for (const voice of voices) {
                if (voice.keySignature && !info.keySignature) info.keySignature = voice.keySignature;
                if (voice.tempo && !info.tempo) info.tempo = voice.tempo;
                if (voice.clef && m === 0 && !clefs[s]) clefs[s] = voice.clef;
            }
            const dynamics = voices.flatMap((voice) => voice.dynamics).sort((a, b) => compare(a.offset, b.offset));
            hairpinStarts[s]!.push(voices.flatMap((voice) => voice.hairpins));
            slurStarts[s]!.push(voices.flatMap((voice, v) => voice.slurs.map((slur) => ({ ...slur, voice: v }))));
            partMeasures[s]!.push({
                voices: voices.map(({ events }) => ({ events })),
                ...(dynamics.length > 0 && { dynamics: dedupeByOffset(dynamics) }),
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
        measureStarts.push(add(measureStarts[m]!, length));
    }

    hairpinStarts.forEach((measures, s) =>
        measures.forEach((starts, m) => {
            const hairpins = placeHairpins(starts, m, measureStarts);
            if (hairpins.length > 0) partMeasures[s]![m]!.hairpins = hairpins;
        }),
    );

    slurStarts.forEach((measures, s) =>
        measures.forEach((starts, m) => {
            for (const slur of starts) slurChords(partMeasures[s]!, slur, m, measureStarts);
        }),
    );

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
    return { title: title || 'Untitled', measures: infos, parts, soundfonts: [] };
}

/**
 * Marks every chord of the slur's voice from where it starts to just before where it ends as
 * slurred on to the next, so the chord it ends on is the last under it
 */
function slurChords(
    partMeasures: PartMeasure[],
    { offset, measures, fractions, voice }: SlurStart & { voice: number },
    m: number,
    measureStarts: Fraction[],
) {
    const last = partMeasures.length - 1;
    const endMeasure = Math.max(0, Math.min(last, m + measures));
    const start = add(measureStarts[m]!, offset);
    const end = add(measureStarts[endMeasure]!, add(offset, fractions));
    for (let measure = m; measure <= endMeasure; measure++) {
        let time = measureStarts[measure]!;
        for (const { event, length } of leaves(partMeasures[measure]?.voices[voice]?.events ?? [])) {
            if (event.kind === 'chord' && compare(time, start) >= 0 && compare(time, end) < 0) event.slur = true;
            time = add(time, length);
        }
    }
}

/** Voices can each carry the same dynamic or hairpin; one at a moment is enough */
function dedupeByOffset<T extends { offset: Fraction }>(marks: T[]): T[] {
    return marks.filter((mark, i) => i === 0 || compare(mark.offset, marks[i - 1]!.offset) !== 0);
}

/**
 * Measure `m`'s hairpins with their lengths, worked out from where each ends. One running past
 * the last measure stops there.
 */
function placeHairpins(starts: HairpinStart[], m: number, measureStarts: Fraction[]): Hairpin[] {
    const last = measureStarts.length - 1;
    const hairpins = starts.flatMap(({ offset, kind, measures, fractions }) => {
        const endMeasure = Math.max(0, Math.min(last, m + measures));
        const end = add(measureStarts[endMeasure]!, add(offset, fractions));
        const length = sub(min(end, measureStarts[last]!), add(measureStarts[m]!, offset));
        return compare(length, ZERO) > 0 ? [{ offset, length, kind }] : [];
    });
    return dedupeByOffset(hairpins.sort((a, b) => compare(a.offset, b.offset)));
}

const min = (a: Fraction, b: Fraction) => (compare(a, b) <= 0 ? a : b);
