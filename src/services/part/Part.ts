/**
 * A part is one instrument's line through the whole composition
 */

import { PartMeasure } from '../measure/Measure';

export interface Part {
    name: string;
    /** Soundfont preset number */
    program: number;
    /** Always the same length as the composition's measures */
    measures: PartMeasure[];
}
