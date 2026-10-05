/**
 * Changes to a composition. Each takes the composition and returns a new one, leaving the
 * original untouched, so the editor can hand edits back like any other result.
 */

import { Composition } from '../composition/Composition';
import { mapLeaves } from '../event/Event';
import { Selection, selectedLeaves } from '../selection/Selection';

const LOWEST_PITCH = 0;
const HIGHEST_PITCH = 127;

/**
 * Moves every note in the selection by `semitones`. If that would take any note out of MIDI's
 * range, nothing moves, so chords keep their shape.
 */
export function transposeSelection(composition: Composition, selection: Selection, semitones: number): Composition {
    const leafRefs = selectedLeaves(composition, selection);
    const selected = new Set(leafRefs.map(({ part, measure, voice, leaf }) => `${part}-${measure}-${voice}-${leaf}`));
    const touched = new Set(leafRefs.map(({ part, measure }) => `${part}-${measure}`));
    let outOfRange = false;

    // Measures outside the selection are shared with the original rather than copied
    const parts = composition.parts.map((part, p) => ({
        ...part,
        measures: part.measures.map((partMeasure, m) => {
            if (!touched.has(`${p}-${m}`)) return partMeasure;
            return {
                ...partMeasure,
                voices: partMeasure.voices.map((voice, v) => ({
                    ...voice,
                    events: mapLeaves(voice.events, (event, leaf) => {
                        if (event.kind !== 'chord' || !selected.has(`${p}-${m}-${v}-${leaf}`)) return event;
                        const notes = event.notes.map((note) => ({ ...note, pitch: note.pitch + semitones }));
                        if (notes.some(({ pitch }) => pitch < LOWEST_PITCH || pitch > HIGHEST_PITCH)) outOfRange = true;
                        return { ...event, notes };
                    }),
                })),
            };
        }),
    }));

    return outOfRange ? composition : { ...composition, parts };
}
