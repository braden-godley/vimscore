/**
 * Shows the rendered score through a viewport, keeping one measure centered. Scrolling is a
 * CSS transform on the score, so moving between measures is smooth and needs no re-render.
 */

import { Composition } from '../../../services/composition/Composition';
import { Cursor } from '../../../services/cursor/Cursor';
import { toNumber } from '../../../services/fraction/Fraction';
import { Selection, TimePoint, selectedLeaves } from '../../../services/selection/Selection';
import { Anchor, ScoreLayout, leafElementIdPrefix, noteElementId, renderScore } from './renderScore';

/** How far a block selection's shading reaches either side of its notes and staves */
const SELECTION_PADDING = 10;

export class ScoreView {
    private layout?: ScoreLayout;
    private composition?: Composition;
    private readonly strip: HTMLDivElement;
    private readonly score: HTMLDivElement;
    private readonly playhead: HTMLDivElement;
    private readonly selectionBox: HTMLDivElement;
    private centeredMeasure = 0;

    constructor(private readonly viewport: HTMLElement) {
        this.strip = document.createElement('div');
        this.strip.className = 'score-strip';
        this.score = document.createElement('div');
        this.playhead = document.createElement('div');
        this.playhead.className = 'playhead';
        this.score.className = 'score';
        this.selectionBox = document.createElement('div');
        this.selectionBox.className = 'selection-box';
        this.selectionBox.hidden = true;
        // The shading goes first so the notes draw over it
        this.strip.append(this.selectionBox, this.score, this.playhead);
        viewport.append(this.strip);

        new ResizeObserver(() => this.applyScroll(false)).observe(viewport);
    }

    render(composition: Composition) {
        this.composition = composition;
        this.layout = renderScore(this.score, composition);
        this.playhead.style.height = `${this.layout.height}px`;
        this.applyScroll(false);
    }

    /** Highlights the cursor's note or rest; undefined clears the highlight */
    select(cursor: Cursor | undefined) {
        this.score.querySelector('.selected')?.classList.remove('selected');
        if (cursor) this.score.querySelector(`#${noteElementId(cursor)}`)?.classList.add('selected');
    }

    /** Highlights everything in a visual selection and shades the region; undefined clears it */
    setSelection(selection: Selection | undefined) {
        for (const element of this.score.querySelectorAll('.in-selection')) element.classList.remove('in-selection');
        const box = selection && this.selectionRect(selection);
        if (!selection || !box || !this.composition) {
            this.selectionBox.hidden = true;
            return;
        }

        for (const leaf of selectedLeaves(this.composition, selection)) {
            for (const element of this.score.querySelectorAll(`[id^="${leafElementIdPrefix(leaf)}"]`)) {
                element.classList.add('in-selection');
            }
        }
        this.selectionBox.hidden = false;
        Object.assign(this.selectionBox.style, {
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.right - box.left}px`,
            height: `${box.bottom - box.top}px`,
        });
    }

    private selectionRect(selection: Selection) {
        const layout = this.layout;
        if (!layout) return undefined;

        if (selection.kind === 'measures') {
            const first = layout.measures[selection.first];
            const last = layout.measures[selection.last];
            if (!first || !last) return undefined;
            return { left: first.x, right: last.x + last.width, top: 0, bottom: layout.height };
        }

        const top = layout.parts[selection.firstPart];
        const bottom = layout.parts[selection.lastPart];
        const left = this.xAt(selection.start);
        const right = this.xAt(selection.end);
        if (!top || !bottom || left === undefined || right === undefined) return undefined;
        return {
            left: left - SELECTION_PADDING,
            right: right - SELECTION_PADDING,
            top: top.top - 2 * SELECTION_PADDING,
            bottom: bottom.bottom + 2 * SELECTION_PADDING,
        };
    }

    /** Where a moment in a measure is drawn */
    private xAt({ measure, offset }: TimePoint): number | undefined {
        const anchors = this.layout?.measures[measure]?.anchors;
        return anchors?.length ? interpolate(anchors, toNumber(offset)) : undefined;
    }

    centerOn(measure: number) {
        if (measure === this.centeredMeasure) return;
        this.centeredMeasure = measure;
        this.applyScroll(true);
    }

    /** Draws the playhead at a time within a measure, in whole notes; undefined hides it */
    setPlayhead(position: { measure: number; time: number } | undefined) {
        const anchors = position && this.layout?.measures[position.measure]?.anchors;
        if (!position || !anchors?.length) {
            this.playhead.hidden = true;
            return;
        }

        this.playhead.hidden = false;
        this.playhead.style.transform = `translateX(${interpolate(anchors, position.time)}px)`;
    }

    private applyScroll(animate: boolean) {
        const box = this.layout?.measures[this.centeredMeasure];
        if (!box) return;
        const offset = this.viewport.clientWidth / 2 - (box.x + box.width / 2);
        this.strip.classList.toggle('animate', animate);
        this.strip.style.transform = `translateX(${offset}px)`;
    }
}

/** Note spacing isn't proportional to time, so interpolate between the drawn note positions */
function interpolate(anchors: Anchor[], time: number): number {
    const after = anchors.findIndex((anchor) => anchor.time > time);
    // At or past the last anchor (the barline), stay on it
    if (after === -1) return anchors.at(-1)!.x;
    const a = anchors[Math.max(0, after - 1)]!;
    const b = anchors[after]!;
    const t = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
    return a.x + t * (b.x - a.x);
}
