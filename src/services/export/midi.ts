/**
 * Writes a composition as a Standard MIDI File (type 1): a first track with the title, tempos,
 * time signatures and keys, then a track for each part with its instrument and notes. Repeats
 * are written out as they play, so any player plays them; ties are joined into single notes,
 * volume markings become note velocities, as they sound in the app, and the mixer's volumes
 * become each channel's volume.
 */

import { Composition } from '../composition/Composition';
import { durationValue } from '../duration/Duration';
import { partInstrument } from '../instrument/Instrument';
import { resolveMeasures, secondsPerWholeNote } from '../measure/Measure';
import { partMix } from '../edit/Mixer';
import { BANK_SELECT, CHANNEL_VOLUME, channelVolume, velocity } from '../synth/channels';
import { performance, playedMeasureAt } from '../timeline/performance';
import { timeline } from '../timeline/timeline';

/** Ticks per quarter note; divides evenly into triplets, quintuplets and sextuplets of sixteenths */
export const TICKS_PER_QUARTER = 480;
/** General MIDI keeps channel 10 (index 9) for drums */
const DRUM_CHANNEL = 9;
/** A file has only 16 channels: the rest go to other parts, in turn, shared past 15 of them */
const PART_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** MIDI's variable-length numbers: seven bits a byte, high bit set on all but the last */
function variableLength(value: number): number[] {
    const bytes = [value & 0x7f];
    for (let rest = value >> 7; rest > 0; rest >>= 7) bytes.unshift((rest & 0x7f) | 0x80);
    return bytes;
}

const uint32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

interface TrackEvent {
    ticks: number;
    /** At the same tick, lower goes first: meta and setup, then note offs, then note ons */
    order: number;
    bytes: number[];
}

const meta = (ticks: number, type: number, data: number[]): TrackEvent => ({
    ticks,
    order: 0,
    bytes: [0xff, type, ...variableLength(data.length), ...data],
});

/** A track chunk: events in order, each after the gap since the last, then the end marker */
function track(events: TrackEvent[]): number[] {
    const sorted = [...events].sort((a, b) => a.ticks - b.ticks || a.order - b.order);
    const data: number[] = [];
    let last = 0;
    for (const { ticks, bytes } of sorted) {
        data.push(...variableLength(ticks - last), ...bytes);
        last = ticks;
    }
    data.push(0, 0xff, 0x2f, 0);
    return [...ascii('MTrk'), ...uint32(data.length), ...data];
}

export function writeMidi(composition: Composition): Uint8Array {
    const resolved = resolveMeasures(composition.measures);
    const played = performance(composition);

    // Where each played measure starts, in ticks, following repeats like the seconds do
    const quarters = (m: number) => {
        const { length } = resolved[m]!;
        return (length.num / length.den) * 4;
    };
    const startTicks: number[] = [];
    played.reduce((ticks, { measure }, i) => {
        startTicks[i] = ticks;
        return ticks + Math.round(quarters(measure) * TICKS_PER_QUARTER);
    }, 0);

    /** A moment in seconds as ticks: within its played measure, at that measure's tempo */
    const ticksAt = (seconds: number) => {
        const index = played.indexOf(playedMeasureAt(played, seconds)!);
        const { measure, startSeconds } = played[index]!;
        const wholeNotes = (seconds - startSeconds) / secondsPerWholeNote(resolved[measure]!.tempo);
        return Math.round(startTicks[index]! + wholeNotes * 4 * TICKS_PER_QUARTER);
    };

    // The first track: everything that isn't a part's, each written where it's played
    const conductor: TrackEvent[] = [meta(0, 0x03, ascii(composition.title))];
    played.forEach(({ measure }, i) => {
        const ticks = startTicks[i]!;
        const info = composition.measures[measure] ?? {};
        const { timeSignature, keySignature, tempo } = resolved[measure]!;
        // At the start, and wherever a change is marked or a repeat jumps back to one
        const jumped = i > 0 && played[i - 1]!.measure !== measure - 1;
        if (i === 0 || jumped || info.tempo) {
            const quartersPerBeat = (durationValue(tempo.beat).num / durationValue(tempo.beat).den) * 4;
            const microsecondsPerQuarter = Math.round(60_000_000 / (tempo.bpm * quartersPerBeat));
            conductor.push(meta(ticks, 0x51, uint32(microsecondsPerQuarter).slice(1)));
        }
        if (i === 0 || jumped || info.timeSignature) {
            const { beats, beatValue } = timeSignature;
            conductor.push(meta(ticks, 0x58, [beats, Math.log2(beatValue), 24, 8]));
        }
        if (i === 0 || jumped || info.keySignature) {
            conductor.push(meta(ticks, 0x59, [keySignature.fifths & 0xff, 0]));
        }
    });

    const notes = timeline(composition);
    const tracks = [track(conductor)];
    const mix = partMix(composition);
    let pitched = 0;
    composition.parts.forEach((part, p) => {
        const { program, bank, drums } = partInstrument(part);
        const channel = drums ? DRUM_CHANNEL : PART_CHANNELS[pitched++ % PART_CHANNELS.length]!;
        const events: TrackEvent[] = [meta(0, 0x03, ascii(part.name))];
        if (!drums) {
            events.push({ ticks: 0, order: 0, bytes: [0xb0 | channel, BANK_SELECT, Math.min(127, bank)] });
            events.push({ ticks: 0, order: 0, bytes: [0xc0 | channel, program] });
        }
        events.push({ ticks: 0, order: 0, bytes: [0xb0 | channel, CHANNEL_VOLUME, channelVolume(mix[p]!)] });
        for (const note of notes) {
            const noteVelocity = velocity(note.volume);
            if (note.part !== p || noteVelocity === 0) continue;
            const start = ticksAt(note.start);
            // At least a tick long, so a note on is never cancelled by its own note off
            const end = Math.max(start + 1, ticksAt(note.start + note.duration));
            events.push({ ticks: start, order: 2, bytes: [0x90 | channel, note.pitch, noteVelocity] });
            events.push({ ticks: end, order: 1, bytes: [0x80 | channel, note.pitch, 0] });
        }
        tracks.push(track(events));
    });

    // Type 1 (tracks played together), the number of tracks, and the ticks per quarter
    const header = [
        ...ascii('MThd'),
        ...uint32(6),
        0,
        1,
        0,
        tracks.length,
        (TICKS_PER_QUARTER >> 8) & 0xff,
        TICKS_PER_QUARTER & 0xff,
    ];
    return new Uint8Array([...header, ...tracks.flat()]);
}
