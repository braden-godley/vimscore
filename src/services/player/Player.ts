import { Composition } from "../composition/Composition";
import { Synth } from "../synth/Synth";
import { TimedNote, timeline } from "../timeline/timeline";

/**
 * How often the scheduler wakes up. Lateness here doesn't affect note timing, because notes
 * are handed to the audio clock ahead of time; it only has to stay under the lookahead.
 */
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SECONDS = 0.1;

/** Delay before the first note so it isn't already late when it gets scheduled */
const START_DELAY_SECONDS = 0.05;

export class Player {
    private notes: TimedNote[] = [];
    private endTime = 0;
    private nextNoteIndex = 0;
    /** AudioContext time at which the composition started */
    private startTime = 0;
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
        return this.playing ? Math.max(0, this.ctx.currentTime - this.startTime) : 0;
    }

    setComposition(composition: Composition) {
        this.stop();

        this.notes = timeline(composition);
        this.endTime = Math.max(0, ...this.notes.map((note) => note.start + note.duration));
    }

    play() {
        if (this.playing || this.notes.length === 0) return;

        // Autoplay policy can leave the context suspended; its clock just waits until it resumes
        void this.ctx.resume();

        this.startTime = this.ctx.currentTime + START_DELAY_SECONDS;
        this.nextNoteIndex = 0;
        this.timer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
        this.schedule();
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

        while (this.nextNoteIndex < this.notes.length) {
            const note = this.notes[this.nextNoteIndex]!;
            const when = this.startTime + note.start;
            if (when > horizon) break;

            this.synth.playNote(note.pitch, when, note.duration);
            this.nextNoteIndex++;
        }

        if (this.nextNoteIndex === this.notes.length && this.ctx.currentTime > this.startTime + this.endTime) {
            this.stop();
        }
    }
}
