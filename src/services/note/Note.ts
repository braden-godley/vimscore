export interface Note {
    /** MIDI note number: 21 is A0, 60 is middle C */
    pitch: number;

    /** Tied to the same pitch in the next chord of the same voice, so they sound as one note */
    tie?: boolean;

    staccato?: boolean;
}
