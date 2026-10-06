/**
 * A part is one instrument's line through the whole composition
 */

import { PartMeasure } from '../measure/Measure';

export type Clef = 'treble' | 'bass';

export interface Part {
    name: string;
    /** Defaults to treble */
    clef?: Clef;
    /** Soundfont preset number, 0 to 127 */
    program: number;
    /** The soundfont bank the program is in, when it's not the standard bank 0 */
    bank?: number;
    /** Plays a drum kit, where each pitch is a different drum */
    drums?: boolean;
    /** The soundfont, by path, the sound was chosen from; see `Instrument.soundfont` */
    soundfont?: string;
    /** The mixer's volume for the whole part, in percent of normal (0 to 127); 100 when not set */
    volume?: number;
    /** Always the same length as the composition's measures */
    measures: PartMeasure[];
}
