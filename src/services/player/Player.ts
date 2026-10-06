import { Composition } from "../composition/Composition";
import { Instrument, partInstrument } from "../instrument/Instrument";
import { DEFAULT_VOLUME } from "../measure/Measure";
import { partMix } from "../edit/Mixer";
import { Synth } from "../synth/Synth";
import { PerformanceOptions } from "../timeline/performance";
import { ARPEGGIO_STEP, TimedNote, timeline } from "../timeline/timeline";

/**
 * How often the scheduler wakes up. Lateness here doesn't affect note timing, because notes
 * are handed to the audio clock ahead of time; it only has to stay under the lookahead.
 */
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.1;

/** Delay before the first note so it isn't already late when it gets scheduled */
const START_DELAY_SECONDS = 0.05;

/** How long a preview sounds: long enough to hear the pitches, short enough to nudge again */
const PREVIEW_SECONDS = 0.35;
/** Long enough to hear an instrument's attack and some of how it holds */
const AUDITION_SECONDS = 0.8;

export class Player {
    private notes: TimedNote[] = [];
    /** What's left to play from the start point, in composition time */
    private queue: TimedNote[] = [];
    private endTime = 0;
    private nextNoteIndex = 0;
    /** AudioContext time at which the composition's time zero is, before the start point */
    private startTime = 0;
    /** Where playback started, in seconds into the composition */
    private from = 0;
    private timer?: ReturnType<typeof setInterval>;

    constructor(
        private ctx: AudioContext,
        private synth: Synth,
    ) {}

    get playing(): boolean {
        return this.timer !== undefined;
    }

    /** Seconds since the start of the composition, for drawing a playhead */
    get position(): number {
        // Clamped so the start delay doesn't read as being before the start point
        return this.playing ? Math.max(this.from, this.ctx.currentTime - this.startTime) : 0;
    }

    /** When the last note finishes, in seconds into the composition */
    get end(): number {
        return this.endTime;
    }

    setComposition(composition: Composition, options: PerformanceOptions = {}) {
        this.stop();

        this.notes = timeline(composition, options);
        this.synth.setInstruments(composition.parts.map(partInstrument));
        this.synth.setMix(partMix(composition));
        this.endTime = Math.max(0, ...this.notes.map((note) => note.start + note.duration));
    }

    /** Takes up a change in the mixer straight away, without stopping */
    setMix(composition: Composition) {
        this.synth.setMix(partMix(composition));
    }

    /**
     * Plays from `from` seconds into the composition. Notes already sounding at that point play
     * for whatever is left of them, so a held chord isn't silent until its next change.
     */
    play(from = 0) {
        if (this.playing) return;

        this.queue = this.notes
            .filter((note) => note.start + note.duration > from)
            .map((note) => {
                const start = Math.max(note.start, from);
                return { ...note, start, duration: note.start + note.duration - start };
            });
        if (this.queue.length === 0) return;

        // Autoplay policy can leave the context suspended; its clock just waits until it resumes
        void this.ctx.resume();

        this.from = from;
        this.startTime = this.ctx.currentTime + START_DELAY_SECONDS - from;
        this.nextNoteIndex = 0;
        this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
        this.schedule();
    }

    /**
     * Sounds pitches together right away on a part's instrument, cutting off any earlier preview.
     * `rolled` brings them in from the bottom up, like an arpeggio. Ignored while playing
     */
    preview(pitches: number[], part: number, rolled = false) {
        if (this.playing) return;
        void this.ctx.resume();
        this.synth.stopAll();
        const now = this.ctx.currentTime;
        [...pitches]
            .sort((a, b) => a - b)
            .forEach((pitch, i) => {
                // Every note still sounds for the whole preview, ending after the last comes in
                const delay = rolled ? i * ARPEGGIO_STEP : 0;
                this.synth.playNote(part, pitch, now + delay, PREVIEW_SECONDS, DEFAULT_VOLUME / 100);
            });
    }

    /** Plays a note on an instrument no part needs to have, to hear what it sounds like */
    audition(instrument: Instrument, pitch: number) {
        if (this.playing) return;
        void this.ctx.resume();
        this.synth.stopAll();
        this.synth.audition(instrument, pitch, AUDITION_SECONDS);
    }

    stop() {
        if (!this.playing) return;
        clearInterval(this.timer);
        this.timer = undefined;
        this.synth.stopAll();
    }

    /** Hands every note starting within the lookahead window to the synth */
    private schedule() {
        const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;

        while (this.nextNoteIndex < this.queue.length) {
            const note = this.queue[this.nextNoteIndex]!;
            const when = this.startTime + note.start;
            if (when > horizon) break;

            this.synth.playNote(note.part, note.pitch, when, note.duration, note.volume);
            this.nextNoteIndex++;
        }

        if (this.nextNoteIndex === this.queue.length && this.ctx.currentTime > this.startTime + this.endTime) {
            this.stop();
        }
    }
}
