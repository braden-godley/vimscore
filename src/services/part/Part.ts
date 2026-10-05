/**
 * A part is one instrument's line through the whole composition
 */

import { PartMeasure } from '../measure/Measure';

export type Clef = 'treble' | 'bass';

export interface Part {
    name: string;
    /** Defaults to treble */
    clef?: Clef;
    /** Soundfont preset number */
    program: number;
    /** Always the same length as the composition's measures */
    measures: PartMeasure[];
}
