/**
 * Draws a whole composition as one continuous horizontal system, every part on its own stave,
 * and reports where each measure ended up so the view can scroll to it.
 */

// The Bravura entry bundles only the Bravura + Academico fonts, not all five
import {
    Accidental,
    Articulation,
    Beam,
    Dot,
    Formatter,
    Renderer,
    Stave,
    StaveConnector,
    StaveNote,
    StaveTie,
    Stem,
    Tuplet,
    Voice,
} from 'vexflow/bravura';
import { Composition } from '../../../services/composition/Composition';
import { Cursor } from '../../../services/cursor/Cursor';
import { Chord, Event, Rest, leaves } from '../../../services/event/Event';
import { ZERO, add, toNumber } from '../../../services/fraction/Fraction';
import { TimeSignature, resolveMeasures } from '../../../services/measure/Measure';
import { Clef } from '../../../services/part/Part';
import { REST_KEYS, durationCode, pitchKey } from './notation';

const LEFT_MARGIN = 30;
const RIGHT_MARGIN = 30;
const TOP_MARGIN = 30;
const PART_SPACING = 120;
/** Extra room beyond VexFlow's minimum so notes aren't crammed */
const NOTE_STRETCH = 1.6;
const MIN_NOTES_WIDTH = 80;
/** Gap between the last note and the barline */
const END_PADDING = 20;

/** Maps a time within a measure to the x where it's drawn */
export interface Anchor {
    /** Whole notes from the start of the measure */
    time: number;
    x: number;
}

export interface MeasureBox {
    x: number;
    width: number;
    /** Positions of every note start, in time order, ending at the barline */
    anchors: Anchor[];
}

export interface ScoreLayout {
    width: number;
    height: number;
    measures: MeasureBox[];
    /** Where each part's stave lines are, top line to bottom line */
    parts: { top: number; bottom: number }[];
}

/** The id VexFlow gets for a notehead; it prefixes `vf-` to make the DOM id */
function noteheadId({ part, measure, voice, leaf, note }: Cursor): string {
    return `note-${part}-${measure}-${voice}-${leaf}-${note}`;
}

/** The DOM id of the SVG group drawn for the note or rest a cursor points at */
export function noteElementId(cursor: Cursor): string {
    return `vf-${noteheadId(cursor)}`;
}

/** What the DOM ids of every notehead in a chord, or its rest, start with */
export function leafElementIdPrefix({ part, measure, voice, leaf }: Omit<Cursor, 'note'>): string {
    return `vf-note-${part}-${measure}-${voice}-${leaf}-`;
}

/** One voice of one part in one measure, ready to format */
interface BuiltVoice {
    voice: Voice;
    /** Parallel arrays: the drawn note for each leaf */
    notes: StaveNote[];
    events: (Chord | Rest)[];
    offsets: number[];
    tuplets: { tuplet: Tuplet; notes: StaveNote[] }[];
    beams: Beam[];
}

function makeNote(event: Chord | Rest, clef: Clef, stemDirection: number | undefined): StaveNote {
    const { duration } = event;
    const note = new StaveNote({
        keys: event.kind === 'chord' ? event.notes.map(({ pitch }) => pitchKey(pitch)) : [REST_KEYS[clef]],
        duration: durationCode(duration) + (event.kind === 'rest' ? 'r' : ''),
        dots: duration.dots,
        clef,
        autoStem: stemDirection === undefined,
        stemDirection,
    });
    if (duration.dots) Dot.buildAndAttach([note], { all: true });
    if (event.kind === 'chord' && event.notes.some((n) => n.staccato)) note.addModifier(new Articulation('a.'), 0);
    return note;
}

function buildVoice(
    events: Event[],
    clef: Clef,
    { beats, beatValue }: TimeSignature,
    stemDirection: number | undefined,
): BuiltVoice {
    const built: BuiltVoice = {
        voice: new Voice({ numBeats: beats, beatValue }).setMode(Voice.Mode.SOFT),
        notes: [],
        events: [],
        offsets: [],
        tuplets: [],
        beams: [],
    };

    // Tuplets are built innermost first, so nested ones multiply their tick scaling
    const build = (events: Event[]): StaveNote[] =>
        events.flatMap((event) => {
            if (event.kind === 'tuplet') {
                const notes = build(event.events);
                if (notes.length > 0) {
                    const tuplet = new Tuplet(notes, { numNotes: event.actual, notesOccupied: event.normal, ratioed: false });
                    built.tuplets.push({ tuplet, notes });
                }
                return notes;
            }
            const note = makeNote(event, clef, stemDirection);
            built.notes.push(note);
            built.events.push(event);
            return [note];
        });
    build(events);

    let offset = ZERO;
    for (const { length } of leaves(events)) {
        built.offsets.push(toNumber(offset));
        offset = add(offset, length);
    }

    built.voice.addTickables(built.notes);
    built.beams = Beam.generateBeams(built.notes, {
        groups: Beam.getDefaultBeamGroups(`${beats}/${beatValue}`),
        stemDirection,
    });
    // Beamed tuplets show just the number, unbeamed ones need a bracket to show their extent
    for (const { tuplet, notes } of built.tuplets) tuplet.setBracketed(notes.some((note) => !note.hasBeam()));
    return built;
}

/** Empty voices are kept so indexes match the model, but VexFlow can't format them */
function hasNotes(voice: BuiltVoice): boolean {
    return voice.notes.length > 0;
}

/** With several voices on a stave, even voices stem up and odd ones down */
function stemDirectionFor(voice: number, voiceCount: number): number | undefined {
    if (voiceCount < 2) return undefined;
    return voice % 2 === 0 ? Stem.UP : Stem.DOWN;
}

export function renderScore(container: HTMLElement, composition: Composition): ScoreLayout {
    const resolved = resolveMeasures(composition.measures);
    const clefs = composition.parts.map((part) => part.clef ?? 'treble');

    const staves: Stave[][] = []; // [measure][part]
    const built: BuiltVoice[][][] = []; // [measure][part][voice], with empty voices kept
    const boxes: MeasureBox[] = [];
    let x = LEFT_MARGIN;

    resolved.forEach(({ timeSignature, length }, m) => {
        const showTimeSignature = m === 0 || composition.measures[m]?.timeSignature !== undefined;

        const column = composition.parts.map((part, p) => {
            const voices = part.measures[m]?.voices ?? [];
            return voices.map((voice, v) =>
                buildVoice(voice.events, clefs[p]!, timeSignature, stemDirectionFor(v, voices.length)),
            );
        });

        const columnStaves = composition.parts.map((_, p) => {
            const stave = new Stave(x, TOP_MARGIN + p * PART_SPACING, 0);
            if (m === 0) stave.addClef(clefs[p]!);
            if (showTimeSignature) stave.addTimeSignature(`${timeSignature.beats}/${timeSignature.beatValue}`);
            return stave;
        });

        // Accidentals take up room, so they go on before measuring
        const formatter = new Formatter();
        column.forEach((voices, p) => {
            // Notes need their stave to place modifiers, and Voice.setStave doesn't pass it on
            for (const { notes } of voices) for (const note of notes) note.setStave(columnStaves[p]!);
            const vfVoices = voices.filter(hasNotes).map(({ voice }) => voice);
            if (vfVoices.length === 0) return;
            Accidental.applyAccidentals(vfVoices, 'C');
            formatter.joinVoices(vfVoices);
        });
        const allVoices = column.flat().filter(hasNotes).map(({ voice }) => voice);

        // Clefs differ in width, so line every stave's notes up with the widest
        const notesX = Math.max(...columnStaves.map((stave) => stave.getNoteStartX()));
        const minWidth = allVoices.length > 0 ? formatter.preCalculateMinTotalWidth(allVoices) : 0;
        const notesWidth = Math.max(MIN_NOTES_WIDTH, minWidth * NOTE_STRETCH);
        const width = notesX - x + notesWidth + END_PADDING;

        for (const stave of columnStaves) {
            // setWidth resets the stave's formatting, which would undo setNoteStartX
            stave.setWidth(width);
            stave.setNoteStartX(notesX);
        }
        if (allVoices.length > 0) formatter.format(allVoices, notesWidth);

        const anchors = new Map<number, number>();
        for (const voice of column.flat()) {
            voice.notes.forEach((note, i) => {
                const time = voice.offsets[i]!;
                anchors.set(time, Math.min(anchors.get(time) ?? Infinity, note.getAbsoluteX()));
            });
        }
        anchors.set(toNumber(length), x + width);

        boxes.push({
            x,
            width,
            anchors: [...anchors].map(([time, ax]) => ({ time, x: ax })).sort((a, b) => a.time - b.time),
        });
        staves.push(columnStaves);
        built.push(column);
        x += width;
    });

    const layout: ScoreLayout = {
        width: x + RIGHT_MARGIN,
        height: TOP_MARGIN * 2 + composition.parts.length * PART_SPACING,
        measures: boxes,
        parts: (staves[0] ?? []).map((stave) => ({ top: stave.getYForLine(0), bottom: stave.getYForLine(4) })),
    };

    container.replaceChildren();
    const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(layout.width, layout.height);
    const ctx = renderer.getContext();

    for (const columnStaves of staves) for (const stave of columnStaves) stave.setContext(ctx).draw();

    const firstColumn = staves[0];
    if (firstColumn && firstColumn.length > 1) {
        const top = firstColumn[0]!;
        const bottom = firstColumn.at(-1)!;
        new StaveConnector(top, bottom).setType('bracket').setContext(ctx).draw();
        new StaveConnector(top, bottom).setType('singleLeft').setContext(ctx).draw();
    }

    built.forEach((column, m) =>
        column.forEach((voices, p) => {
            voices.forEach(({ notes }, v) =>
                notes.forEach((staveNote, leaf) =>
                    // Ids go on just before drawing, because setting a stem direction rebuilds the noteheads.
                    // The model's note order is VexFlow's key order, so the indexes line up
                    staveNote.noteHeads.forEach((head, note) =>
                        head.setAttribute('id', noteheadId({ part: p, measure: m, voice: v, leaf, note })),
                    ),
                ),
            );
            for (const { voice, beams, tuplets } of voices.filter(hasNotes)) {
                voice.draw(ctx, staves[m]![p]!);
                for (const beam of beams) beam.setContext(ctx).draw();
                for (const { tuplet } of tuplets) tuplet.setContext(ctx).draw();
            }
        }),
    );

    drawTies(ctx, composition, built);
    return layout;
}

/**
 * Ties a note to the same pitch in the next chord of its voice, which may be in the next
 * measure. Matches how playback merges ties, so what you see is what you hear.
 */
function drawTies(ctx: ReturnType<Renderer['getContext']>, composition: Composition, built: BuiltVoice[][][]) {
    composition.parts.forEach((part, p) => {
        const voiceCount = Math.max(0, ...part.measures.map((measure) => measure.voices.length));

        for (let v = 0; v < voiceCount; v++) {
            // Every leaf of this voice through the whole piece, in order
            const sequence = built.flatMap((column) => {
                const voice = column[p]?.[v];
                return voice ? voice.events.map((event, i) => ({ event, note: voice.notes[i]! })) : [];
            });

            sequence.forEach(({ event, note }, i) => {
                const next = sequence[i + 1];
                if (event.kind !== 'chord' || next?.event.kind !== 'chord') return;
                const nextPitches = next.event.notes.map(({ pitch }) => pitch);

                event.notes.forEach(({ pitch, tie }, index) => {
                    const lastIndex = nextPitches.indexOf(pitch);
                    if (!tie || lastIndex === -1) return;
                    new StaveTie({ firstNote: note, lastNote: next.note, firstIndexes: [index], lastIndexes: [lastIndex] })
                        .setContext(ctx)
                        .draw();
                });
            });
        }
    });
}
