/**
 * Reads Organya songs (`.org`), the format Cave Story's music is written in, from Org-01 to
 * Org-03.
 *
 * A song has 16 tracks, each playing one sound and one note at a time: eight melodic tracks,
 * each on one of Organya's 100 waveforms, and eight drum tracks. Notes sit on a grid of steps,
 * a number of them to the beat, and the song loops between two steps forever.
 *
 * Each melodic track becomes a part, named for its waveform. Organya's waveforms have no General
 * MIDI equivalent, so a track plays a square lead, or a synth bass if it's mostly low, to be
 * changed with :instrument. The drum tracks become one drum part, each drum played by the
 * General MIDI drum nearest it. The loop becomes repeat barlines when it starts and ends on
 * barlines, and the song ends where the loop does. Volumes become dynamics; changes to a note's
 * volume while it sounds, and panning, are left out.
 */

import { Composition } from '../composition/Composition';
import { TimeSignature } from '../measure/Measure';
import { DRUM_CHANNEL, MidiFile, MidiNote, writeOut } from './Midi';

const MAGICS = ['Org-01', 'Org-02', 'Org-03'];
const TRACKS = 16;
const MELODIC_TRACKS = 8;
/** A key that leaves the note sounding, changing only its volume or panning */
const NO_CHANGE = 255;
/** Organya's key 0 is C1 */
const LOWEST_MIDI = 24;
/** What a note is played at before any volume is set, and the volume that's written mf */
const DEFAULT_VOLUME = 200;
const MEZZO_FORTE_VELOCITY = 88;
const SQUARE_LEAD = 80;
const SYNTH_BASS = 38;
/** Below this, as a MIDI note, a track mostly plays bass */
const BASS_BELOW = 48;

/**
 * The General MIDI drum for each of Organya's drums, by number: Cave Story's twelve (Bass01,
 * Bass02, Snare01, Snare02, Tom01, HiClose, HiOpen, Crash, Per01, Per02, Bass03, Tom02), then
 * the ones later versions of Organya added (Bass04, Bass05, Snare03, Snare04, HiClose2,
 * HiOpen2, HiClose3, HiOpen3, Crash02, RevSym01, Ride01, Tom03, Tom04, OrcDrm, Bell, Cat,
 * Bass06, Bass07, Snare05, Snare06, Snare07, Tom05, HiOpen4, HiClose4, Clap01, Pesi01,
 * Quick01, Bass08, Snare08, HiClose5)
 */
const DRUMS = [
    36, 35, 38, 40, 45, 42, 46, 49, 76, 77, 36, 48,
    35, 36, 38, 40, 42, 46, 42, 46, 57, 55, 51, 43, 47, 41, 53, 56, 35, 36, 38, 40, 38, 50, 46, 42, 39, 37, 75, 36, 38, 44,
];
/** A drum past the ones known */
const OTHER_DRUM = 37;

export function readOrganya(data: Uint8Array): Composition | { error: string } {
    const magic = new TextDecoder('latin1').decode(data.subarray(0, 6));
    if (!MAGICS.includes(magic)) return { error: 'Not an Organya song' };
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerEnd = 18 + TRACKS * 6;
    if (data.length < headerEnd) return { error: 'A damaged Organya song' };

    const wait = view.getUint16(6, true);
    const beatsPerMeasure = data[8]!;
    const stepsPerBeat = data[9]!;
    const loopStart = view.getInt32(10, true);
    const loopEnd = view.getInt32(14, true);
    if (wait === 0 || beatsPerMeasure === 0 || stepsPerBeat === 0) return { error: 'A damaged Organya song' };

    // Three or six steps to the beat swing in threes, written in compound time: 12/8, not 4/4
    const compound = stepsPerBeat % 3 === 0;
    const timeSignature: TimeSignature = compound ? { beats: beatsPerMeasure * 3, beatValue: 8 } : { beats: beatsPerMeasure, beatValue: 4 };
    const stepsPerQuarter = compound ? (stepsPerBeat * 2) / 3 : stepsPerBeat;
    const end = loopEnd > 0 ? loopEnd : undefined;

    const notes: MidiNote[] = [];
    const names: (string | undefined)[] = [];
    let at = headerEnd;
    for (let track = 0; track < TRACKS; track++) {
        const base = 18 + track * 6;
        const wave = data[base + 2]!;
        const count = view.getUint16(base + 4, true);
        if (at + count * 8 > data.length) return { error: 'A damaged Organya song' };
        // Each note's position, then key, length, volume and panning, a list of each
        const position = (i: number) => view.getInt32(at + i * 4, true);
        const field = (offset: number) => (i: number) => data[at + count * offset + i]!;
        const key = field(4);
        const length = field(5);
        const volume = field(6);
        const drums = track >= MELODIC_TRACKS;

        const played: MidiNote[] = [];
        let level = DEFAULT_VOLUME;
        for (let i = 0; i < count; i++) {
            if (volume(i) !== NO_CHANGE) level = volume(i);
            const start = position(i);
            if (key(i) === NO_CHANGE || (end !== undefined && start >= end)) continue;
            // A track plays one note at a time, so the next one cuts it short
            const previous = played.at(-1);
            if (previous && previous.end > start) previous.end = start;
            // Two notes on the same step: the later one is what's heard
            if (previous && previous.end <= previous.start) played.pop();
            played.push({
                track: drums ? MELODIC_TRACKS : track,
                channel: drums ? DRUM_CHANNEL : track,
                program: 0,
                pitch: drums ? (DRUMS[wave] ?? OTHER_DRUM) : LOWEST_MIDI + key(i),
                velocity: velocity(level),
                start,
                end: Math.min(start + Math.max(1, length(i)), end ?? Infinity),
            });
        }
        at += count * 8;

        if (!drums && played.length > 0) {
            const pitches = played.map(({ pitch }) => pitch).sort((a, b) => a - b);
            const program = pitches[Math.floor(pitches.length / 2)]! < BASS_BELOW ? SYNTH_BASS : SQUARE_LEAD;
            for (const note of played) note.program = program;
            names[track] = `Wave ${wave}`;
        }
        notes.push(...played);
    }
    if (notes.length === 0) return { error: 'No notes in it' };
    names[MELODIC_TRACKS] = 'Drums';

    const file: MidiFile = {
        format: 1,
        ticksPerQuarter: stepsPerQuarter,
        notes,
        tempos: [{ tick: 0, value: Math.round(wait * stepsPerQuarter * 1000) }],
        timeSignatures: [{ tick: 0, value: timeSignature }],
        keys: [],
        names,
        ...(end !== undefined && { end, loop: { start: Math.max(0, loopStart), end } }),
    };
    return writeOut(file);
}

/**
 * Organya plays each step of volume 0.08 dB louder or softer; a note struck that much softer
 * has about the square root of the loudness to lose. The usual volume is mf
 */
function velocity(volume: number): number {
    const decibels = ((volume - DEFAULT_VOLUME) * 8) / 100;
    return Math.max(1, Math.min(127, Math.round(MEZZO_FORTE_VELOCITY * 10 ** (decibels / 40))));
}
