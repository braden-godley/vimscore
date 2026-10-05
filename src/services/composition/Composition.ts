/**
 * A composition is the top-level data structure. It has the following attributes:
 * - Title
 * - Measures, holding what all parts share: time signature and tempo
 * - Parts, each holding its own contents for every measure
 * - Soundfont
 */

import { MeasureInfo } from '../measure/Measure';
import { Part } from '../part/Part';
import { Soundfont } from '../soundfont/Soundfont';

export interface Composition {
    title: string;
    measures: MeasureInfo[];
    parts: Part[];
    soundfont: Soundfont;
}
