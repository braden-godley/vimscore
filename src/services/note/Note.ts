export interface Note {
    /* 0 is A0, 12 is A1, and so on... */
    pitch: number;

    /**
     * The following numbers correspond to different note durations:
     * 0: 64th note
     * 1: 32nd note
     * 2: 16th note
     * 3: 8th note
     * 4: quarter note
     * 5: half note
     * 6: whole note
     * 7: dotted whole note
     */
    duration: number;

    /** The number of 64th note durations to wait in the measure before this note is played */
    startsAt: number;

    /* Whether the note is dotted, making it 1.5x longer */
    dotted?: boolean;

    stacatto?: boolean;
}
