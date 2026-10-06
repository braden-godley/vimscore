/**
 * Draws a whole composition as one continuous horizontal system, every part on its own stave,
 * and reports where each measure ended up so the view can scroll to it.
 */

// The Bravura entry bundles only the Bravura + Academico fonts, not all five
import {
    Accidental,
    Articulation,
    BarlineType,
    Beam,
    CanvasContext,
    Dot,
    Formatter,
    Modifier,
    RenderContext,
    Renderer,
    Stave,
    StaveConnector,
    StaveNote,
    StaveTie,
    Stem,
    Stroke,
    Tuplet,
    Voice,
} from 'vexflow/bravura';
import { Composition } from '../../../services/composition/Composition';
import { Cursor } from '../../../services/cursor/Cursor';
import { Chord, Event, Rest, glissandoTarget, leaves } from '../../../services/event/Event';
import { ZERO, add, toNumber } from '../../../services/fraction/Fraction';
import { ResolvedMeasure, TimeSignature, resolveMeasures } from '../../../services/measure/Measure';
import { Clef } from '../../../services/part/Part';
import { REST_KEYS, durationCode, keySpec, pitchKey } from './notation';
import { midi } from '../../../services/pitch/Pitch';

export const LEFT_MARGIN = 30;
/** Staff names sit left of the first measure, this far from its start */
const NAME_GAP = 24;
export const NAME_FONT = '13px Georgia, serif';
const RIGHT_MARGIN = 30;
const TOP_MARGIN = 30;
const PART_SPACING = 120;
/** Extra room beyond VexFlow's minimum so notes aren't crammed */
const NOTE_STRETCH = 1.6;
const MIN_NOTES_WIDTH = 80;
/** Gap between the last note and the barline */
const END_PADDING = 20;
/** Volume markings sit this far under the bottom stave line, clear of most stems and ledger lines */
const VOLUME_TEXT_GAP = 32;
const VOLUME_FONT_SIZE = 12;
/** A hairpin's wedge opens this far each side of the middle of the volume text */
const HAIRPIN_HALF_HEIGHT = 5;
/** Room between a hairpin and a volume marking at either end of it */
const HAIRPIN_GAP = 4;
/** Room between a glissando's line and the noteheads at its ends */
const GLISSANDO_GAP = 3;
/** How far above the top stave line tempo marks sit, in VexFlow's offset from the stave */
const TEMPO_Y = -10;

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
    /** Where each part's stave is: its y for VexFlow, and its top and bottom lines */
    parts: { y: number; top: number; bottom: number }[];
    /** Where the staff names end, at the left of the first measure */
    namesRight: number;
    /** Where each chord or rest is drawn, by `leafElementId` */
    leafX: Map<string, number>;
}

let measuring: CanvasRenderingContext2D | null | undefined;

/** How wide text is in the staff name font */
export function textWidth(text: string): number {
    measuring ??= document.createElement('canvas').getContext('2d');
    if (!measuring) return text.length * 7;
    measuring.font = NAME_FONT;
    return Math.ceil(measuring.measureText(text).width);
}

/** Note spacing isn't proportional to time, so interpolate between the drawn note positions */
export function interpolate(anchors: Anchor[], time: number): number {
    const after = anchors.findIndex((anchor) => anchor.time > time);
    // At or past the last anchor (the barline), stay on it
    if (after === -1) return anchors.at(-1)!.x;
    const a = anchors[Math.max(0, after - 1)]!;
    const b = anchors[after]!;
    const t = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
    return a.x + t * (b.x - a.x);
}

/** The id VexFlow gets for a notehead; it prefixes `vf-` to make the DOM id */
function noteheadId({ part, measure, voice, leaf, note }: Cursor): string {
    return `note-${part}-${measure}-${voice}-${leaf}-${note}`;
}

/** The DOM id of the SVG group drawn for the note or rest a cursor points at */
export function noteElementId(cursor: Cursor): string {
    return `vf-${noteheadId(cursor)}`;
}

/** The DOM id of the SVG group for a whole chord or rest, stem and all */
export function leafElementId({ part, measure, voice, leaf }: Omit<Cursor, 'note'>): string {
    return `vf-leaf-${part}-${measure}-${voice}-${leaf}`;
}

/** What the DOM ids of every notehead in a chord, or its rest, start with */
export function leafElementIdPrefix({ part, measure, voice, leaf }: Omit<Cursor, 'note'>): string {
    return `vf-note-${part}-${measure}-${voice}-${leaf}-`;
}

/** Puts articulations on the notehead side, away from the stem, once the stem direction is final */
export function placeArticulations(note: StaveNote) {
    const position = note.getStemDirection() === Stem.UP ? Modifier.Position.BELOW : Modifier.Position.ABOVE;
    for (const modifier of note.getModifiersByType(Articulation.CATEGORY)) modifier.setPosition(position);
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
    // Only this chord's notes, not another voice's sharing the stave
    if (event.kind === 'chord' && event.arpeggio) {
        note.addModifier(new Stroke(Stroke.Type.ARPEGGIO_DIRECTIONLESS, { allVoices: false }), 0);
    }
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

/**
 * Where to draw: an SVG in a container, as the editor shows it, or a canvas showing the part of
 * the score from `left` (in score units), at `scale`, as video frames are made from.
 */
export type ScoreTarget =
    | HTMLElement
    | { canvas: CanvasRenderingContext2D; left: number; top: number; scale: number };

/**
 * One measure of every part, laid out from x = 0 so it can be drawn anywhere along the system.
 * Only the measure itself goes in: what reaches across measures, like ties, is drawn over them.
 */
interface Column {
    /** What it's built from: the same things, compared by identity, build the same column */
    inputs: unknown[];
    width: number;
    staves: Stave[];
    /** [part][voice], with empty voices kept */
    voices: BuiltVoice[][];
    /** Relative to the column's left edge */
    anchors: Anchor[];
    /** Its SVG group, once drawn into a cached container */
    group?: SVGGElement;
}

/**
 * What a container was last drawn with. Edits share every measure they don't touch, so passing
 * the same cache to each render lays out and draws only the measures that changed; the rest
 * are moved into place.
 */
export class ScoreCache {
    container?: HTMLElement;
    context?: RenderContext;
    columns: Column[] = [];
    /** What's drawn over the measures, redrawn every time */
    overlay?: SVGGElement;
}

const sameInputs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((input, i) => input === b[i]);

function columnInputs(composition: Composition, resolved: ResolvedMeasure[], m: number): unknown[] {
    const { timeSignature, keySignature, tempo } = resolved[m]!;
    const previousKey = resolved[m - 1]?.keySignature;
    return [
        m,
        composition.measures[m],
        // Inherited from earlier measures, so compared by value
        `${timeSignature.beats}/${timeSignature.beatValue} ${keySignature.fifths} ${previousKey?.fifths} ${tempo.bpm} ${tempo.beat.base}.${tempo.beat.dots}`,
        ...composition.parts.flatMap((part) => [part.clef ?? 'treble', part.measures[m]]),
    ];
}

function buildColumn(composition: Composition, resolved: ResolvedMeasure[], m: number, inputs: unknown[]): Column {
    const { timeSignature, keySignature, tempo, length } = resolved[m]!;
    const clefs = composition.parts.map((part) => part.clef ?? 'treble');
    const showTimeSignature = m === 0 || composition.measures[m]?.timeSignature !== undefined;
    const showKeySignature = m === 0 || composition.measures[m]?.keySignature !== undefined;
    const showTempo = m === 0 || composition.measures[m]?.tempo !== undefined;

    const column = composition.parts.map((part, p) => {
        const voices = part.measures[m]?.voices ?? [];
        return voices.map((voice, v) => buildVoice(voice.events, clefs[p]!, timeSignature, stemDirectionFor(v, voices.length)));
    });

    const staves = composition.parts.map((_, p) => {
        const stave = new Stave(0, TOP_MARGIN + p * PART_SPACING, 0);
        if (m === 0) stave.addClef(clefs[p]!);
        // A key change cancels the old key's sharps or flats with naturals
        const previousKey = resolved[m - 1]?.keySignature;
        if (showKeySignature) stave.addKeySignature(keySpec(keySignature), previousKey && keySpec(previousKey));
        if (showTimeSignature) stave.addTimeSignature(`${timeSignature.beats}/${timeSignature.beatValue}`);
        const info = composition.measures[m];
        if (info?.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (info?.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
        // A metronome mark over the top stave, like ♩ = 120
        if (showTempo && p === 0) {
            stave.setTempo({ duration: durationCode(tempo.beat), dots: tempo.beat.dots, bpm: tempo.bpm }, TEMPO_Y);
        }
        return stave;
    });

    // Accidentals take up room, so they go on before measuring
    const formatter = new Formatter();
    column.forEach((voices, p) => {
        // Notes need their stave to place modifiers, and Voice.setStave doesn't pass it on
        for (const { notes } of voices) for (const note of notes) note.setStave(staves[p]!);
        const vfVoices = voices.filter(hasNotes).map(({ voice }) => voice);
        if (vfVoices.length === 0) return;
        Accidental.applyAccidentals(vfVoices, keySpec(keySignature));
        formatter.joinVoices(vfVoices);
    });
    const allVoices = column.flat().filter(hasNotes).map(({ voice }) => voice);

    // Clefs differ in width, so line every stave's notes up with the widest
    const notesX = Math.max(...staves.map((stave) => stave.getNoteStartX()));
    const minWidth = allVoices.length > 0 ? formatter.preCalculateMinTotalWidth(allVoices) : 0;
    const notesWidth = Math.max(MIN_NOTES_WIDTH, minWidth * NOTE_STRETCH);
    const width = notesX + notesWidth + END_PADDING;

    for (const stave of staves) {
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
    anchors.set(toNumber(length), width);

    return {
        inputs,
        width,
        staves,
        voices: column,
        anchors: [...anchors].map(([time, x]) => ({ time, x })).sort((a, b) => a.time - b.time),
    };
}

/** Draws a column's staves and notes, from x = 0 in whatever coordinates the context has */
function drawColumn(ctx: RenderContext, { staves, voices }: Column, m: number) {
    for (const stave of staves) stave.setContext(ctx).draw();

    // The first measure brackets the staves together
    if (m === 0 && staves.length > 1) {
        const top = staves[0]!;
        const bottom = staves.at(-1)!;
        new StaveConnector(top, bottom).setType('bracket').setContext(ctx).draw();
        new StaveConnector(top, bottom).setType('singleLeft').setContext(ctx).draw();
    }

    voices.forEach((partVoices, p) => {
        partVoices.forEach(({ notes }, v) =>
            notes.forEach((staveNote, leaf) => {
                // Beaming can flip stems, so this waits until now
                placeArticulations(staveNote);
                // VexFlow prefixes `vf-` itself
                staveNote.setAttribute('id', leafElementId({ part: p, measure: m, voice: v, leaf }).slice(3));
                // Ids go on just before drawing, because setting a stem direction rebuilds the noteheads.
                // The model's note order is VexFlow's key order, so the indexes line up
                staveNote.noteHeads.forEach((head, note) =>
                    head.setAttribute('id', noteheadId({ part: p, measure: m, voice: v, leaf, note })),
                );
            }),
        );
        for (const { voice, beams, tuplets } of partVoices.filter(hasNotes)) {
            voice.draw(ctx, staves[p]!);
            for (const beam of beams) beam.setContext(ctx).draw();
            for (const { tuplet } of tuplets) tuplet.setContext(ctx).draw();
        }
    });
}

/**
 * Draws the score into `target`. With a cache, measures that haven't changed since the last
 * render into the same container are reused rather than laid out and drawn again.
 */
export function renderScore(target: ScoreTarget, composition: Composition, cache = new ScoreCache()): ScoreLayout {
    const resolved = resolveMeasures(composition.measures);
    const svg = target instanceof HTMLElement;
    if (!svg || cache.container !== target) {
        Object.assign(cache, new ScoreCache());
    }

    const previous = cache.columns;
    const columns = resolved.map((_, m) => {
        const inputs = columnInputs(composition, resolved, m);
        const old = previous[m];
        return old && sameInputs(old.inputs, inputs) ? old : buildColumn(composition, resolved, m, inputs);
    });

    // Room on the left for the longest staff name
    const namesRight = LEFT_MARGIN + Math.max(0, ...composition.parts.map(({ name }) => textWidth(name)));
    let x = namesRight + NAME_GAP;
    const offsets = columns.map(({ width }) => {
        const offset = x;
        x += width;
        return offset;
    });

    const layout: ScoreLayout = {
        width: x + RIGHT_MARGIN,
        height: TOP_MARGIN * 2 + composition.parts.length * PART_SPACING,
        measures: columns.map(({ width, anchors }, m) => ({
            x: offsets[m]!,
            width,
            anchors: anchors.map((anchor) => ({ time: anchor.time, x: anchor.x + offsets[m]! })),
        })),
        parts: (columns[0]?.staves ?? []).map((stave) => ({
            y: stave.getY(),
            top: stave.getYForLine(0),
            bottom: stave.getYForLine(4),
        })),
        leafX: new Map(),
        namesRight,
    };
    columns.forEach(({ voices }, measure) =>
        voices.forEach((partVoices, part) =>
            partVoices.forEach(({ notes }, voice) =>
                notes.forEach((note, leaf) =>
                    layout.leafX.set(leafElementId({ part, measure, voice, leaf }), note.getAbsoluteX() + offsets[measure]!),
                ),
            ),
        ),
    );

    let ctx: RenderContext;
    if (svg) {
        if (!cache.context) {
            target.replaceChildren();
            cache.container = target;
            cache.context = new Renderer(target as HTMLDivElement, Renderer.Backends.SVG).getContext();
        }
        ctx = cache.context;
        ctx.resize(layout.width, layout.height);
        const kept = new Set(columns);
        for (const old of previous) if (!kept.has(old)) old.group?.remove();
        cache.overlay?.remove();

        columns.forEach((column, m) => {
            if (!column.group) {
                column.group = ctx.openGroup('measure') as SVGGElement;
                drawColumn(ctx, column, m);
                ctx.closeGroup();
            }
            column.group.setAttribute('transform', `translate(${offsets[m]}, 0)`);
        });
        cache.overlay = ctx.openGroup('overlay') as SVGGElement;
    } else {
        // Everything is drawn in score units; the transform puts the wanted part on the canvas
        const { canvas, left, top, scale } = target;
        ctx = new CanvasContext(canvas);
        columns.forEach((column, m) => {
            canvas.setTransform(scale, 0, 0, scale, (offsets[m]! - left) * scale, -top * scale);
            drawColumn(ctx, column, m);
        });
        canvas.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    }
    cache.columns = columns;

    // Each staff's name, right-aligned up to the first measure and centered on the stave
    ctx.save();
    ctx.setFont(NAME_FONT);
    composition.parts.forEach(({ name }, p) => {
        const stave = layout.parts[p];
        if (stave) ctx.fillText(name, namesRight - textWidth(name), (stave.top + stave.bottom) / 2 + 4);
    });
    ctx.restore();

    drawTies(ctx, composition, columns, offsets);
    drawGlissandi(ctx, composition, columns, offsets);
    drawVolumes(ctx, composition, layout);
    drawHairpins(ctx, composition, layout);
    if (svg) ctx.closeGroup();
    return layout;
}

/** Each volume marking as text under its stave, at its beat: `v=60%` */
function drawVolumes(ctx: RenderContext, composition: Composition, layout: ScoreLayout) {
    ctx.save();
    ctx.setFont('Georgia, serif', VOLUME_FONT_SIZE, 'normal', 'italic');
    composition.parts.forEach((part, p) => {
        const stave = layout.parts[p];
        part.measures.forEach((partMeasure, m) => {
            const anchors = layout.measures[m]?.anchors;
            if (!stave || !anchors?.length) return;
            for (const { offset, percent } of partMeasure.volumes ?? []) {
                ctx.fillText(`v=${percent}%`, interpolate(anchors, toNumber(offset)), stave.bottom + VOLUME_TEXT_GAP);
            }
        });
    });
    ctx.restore();
}

/**
 * Each hairpin as a wedge in line with the volume markings, opening toward the loud end. It
 * starts after a marking at its start and stops short of one at its end.
 */
function drawHairpins(ctx: RenderContext, composition: Composition, layout: ScoreLayout) {
    const resolved = resolveMeasures(composition.measures);
    const starts = resolved.map(({ start }) => toNumber(start));
    /** Where a time from the start of the piece is drawn; an end on a barline stays in the measure before */
    const xAt = (time: number, end: boolean) => {
        let m = 0;
        while (m + 1 < starts.length && (end ? starts[m + 1]! < time : starts[m + 1]! <= time)) m++;
        const anchors = layout.measures[m]?.anchors;
        return anchors?.length ? interpolate(anchors, time - starts[m]!) : undefined;
    };

    ctx.save();
    ctx.setFont('Georgia, serif', VOLUME_FONT_SIZE, 'normal', 'italic');
    ctx.setLineWidth(1);
    composition.parts.forEach((part, p) => {
        const stave = layout.parts[p];
        if (!stave) return;
        const y = stave.bottom + VOLUME_TEXT_GAP - VOLUME_FONT_SIZE / 3;
        const marks = part.measures.flatMap((partMeasure, m) =>
            (partMeasure.volumes ?? []).map(({ offset, percent }) => ({
                time: starts[m]! + toNumber(offset),
                width: ctx.measureText(`v=${percent}%`).width,
            })),
        );
        part.measures.forEach((partMeasure, m) => {
            for (const { offset, length, kind } of partMeasure.hairpins ?? []) {
                const start = starts[m]! + toNumber(offset);
                const end = start + toNumber(length);
                let [left, right] = [xAt(start, false), xAt(end, true)];
                if (left === undefined || right === undefined) continue;
                const markAtStart = marks.find(({ time }) => time === start);
                if (markAtStart) left += markAtStart.width + HAIRPIN_GAP;
                if (marks.some(({ time }) => time === end)) right -= HAIRPIN_GAP;
                if (right <= left) continue;
                // The point is at the soft end
                const [point, open] = kind === 'crescendo' ? [left, right] : [right, left];
                ctx.beginPath();
                ctx.moveTo(open, y - HAIRPIN_HALF_HEIGHT);
                ctx.lineTo(point, y);
                ctx.lineTo(open, y + HAIRPIN_HALF_HEIGHT);
                ctx.stroke();
            }
        });
    });
    ctx.restore();
}

/**
 * A tie between notes that may be in different columns, each moved along by where its column
 * is drawn
 */
class ShiftedTie extends StaveTie {
    constructor(
        notes: ConstructorParameters<typeof StaveTie>[0],
        private readonly firstShift: number,
        private readonly lastShift: number,
    ) {
        super(notes);
    }

    override getFirstX(): number {
        return super.getFirstX() + this.firstShift;
    }

    override getLastX(): number {
        return super.getLastX() + this.lastShift;
    }
}

/**
 * Every chord or rest of each voice of each part through the whole piece, in order, with its
 * drawn note and where its column starts
 */
function voiceSequences(
    composition: Composition,
    columns: Column[],
    offsets: number[],
): { event: Chord | Rest; note: StaveNote; shift: number }[][] {
    return composition.parts.flatMap((part, p) => {
        const voiceCount = Math.max(0, ...part.measures.map((measure) => measure.voices.length));
        return Array.from({ length: voiceCount }, (_, v) =>
            columns.flatMap((column, m) => {
                const voice = column.voices[p]?.[v];
                return voice ? voice.events.map((event, i) => ({ event, note: voice.notes[i]!, shift: offsets[m]! })) : [];
            }),
        );
    });
}

/**
 * Ties a note to the same pitch in the next chord of its voice, which may be in the next
 * measure. Matches how playback merges ties, so what you see is what you hear.
 */
function drawTies(ctx: RenderContext, composition: Composition, columns: Column[], offsets: number[]) {
    for (const sequence of voiceSequences(composition, columns, offsets)) {
        sequence.forEach(({ event, note, shift }, i) => {
            const next = sequence[i + 1];
            if (event.kind !== 'chord' || next?.event.kind !== 'chord') return;
            const nextPitches = next.event.notes.map(({ pitch }) => midi(pitch));

            event.notes.forEach(({ pitch, tie }, index) => {
                const lastIndex = nextPitches.indexOf(midi(pitch));
                if (!tie || lastIndex === -1) return;
                const notes = { firstNote: note, lastNote: next.note, firstIndexes: [index], lastIndexes: [lastIndex] };
                new ShiftedTie(notes, shift, next.shift).setContext(ctx).draw();
            });
        });
    }
}

/**
 * A straight line from each sliding note to the note of the next chord it lands on, the one
 * playback slides to, stopping short of that note's accidental
 */
function drawGlissandi(ctx: RenderContext, composition: Composition, columns: Column[], offsets: number[]) {
    ctx.save();
    ctx.setLineWidth(1.2);
    for (const sequence of voiceSequences(composition, columns, offsets)) {
        sequence.forEach(({ event, note, shift }, i) => {
            const next = sequence[i + 1];
            if (event.kind !== 'chord' || next?.event.kind !== 'chord') return;
            const nextChord = next.event;
            event.notes.forEach(({ glissando }, index) => {
                if (!glissando) return;
                const target = glissandoTarget(index, event, nextChord);
                const left = shift + note.getTieRightX() + GLISSANDO_GAP;
                const right = next.shift + next.note.getAbsoluteX() - next.note.getMetrics().modLeftPx - GLISSANDO_GAP;
                if (right <= left) return;
                ctx.beginPath();
                ctx.moveTo(left, note.getYs()[index]!);
                ctx.lineTo(right, next.note.getYs()[target]!);
                ctx.stroke();
            });
        });
    }
    ctx.restore();
}
