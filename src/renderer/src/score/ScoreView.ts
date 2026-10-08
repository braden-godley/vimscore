/**
 * Shows the rendered score through a viewport, keeping one measure centered. Scrolling is a
 * CSS transform on the score, so moving between measures is smooth and needs no re-render.
 */

import { clefAt } from '../../../services/clef/Clef';
import { Composition } from '../../../services/composition/Composition';
import { Cursor } from '../../../services/cursor/Cursor';
import { toNumber } from '../../../services/fraction/Fraction';
import { C_MAJOR } from '../../../services/key/KeySignature';
import { resolveMeasures } from '../../../services/measure/Measure';
import { Phantom } from '../../../services/phantom/Phantom';
import { Selection, TimePoint, selectedLeaves } from '../../../services/selection/Selection';
import { drawPhantom } from './drawPhantom';
import {
    LEFT_MARGIN,
    ScoreCache,
    ScoreLayout,
    interpolate,
    leafElementId,
    leafElementIdPrefix,
    noteElementId,
    renderScore,
} from './renderScore';

/** How far a block selection's shading reaches either side of its notes and staves */
const SELECTION_PADDING = 10;

export class ScoreView {
    private layout?: ScoreLayout;
    private composition?: Composition;
    /** So an edit redraws only the measures it changed */
    private readonly cache = new ScoreCache();
    private readonly strip: HTMLDivElement;
    private readonly score: HTMLDivElement;
    private readonly playhead: HTMLDivElement;
    private readonly selectionBox: HTMLDivElement;
    private readonly phantomLayer: HTMLDivElement;
    /** Staff names pinned to the left edge, for when the ones in the score are scrolled away */
    private readonly names: HTMLDivElement;
    private centeredMeasure = 0;
    /** The part kept in view when the score is taller than the viewport; undefined keeps the last */
    private centeredPart = 0;
    private fitting = false;
    /** How far the drawing reaches above and below, which notes on ledger lines can push past the layout */
    private drawn = { top: 0, bottom: 0 };

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
        this.phantomLayer = document.createElement('div');
        this.phantomLayer.className = 'phantom';
        // The shading goes first so the notes draw over it
        this.strip.append(this.selectionBox, this.score, this.phantomLayer, this.playhead);
        this.names = document.createElement('div');
        this.names.className = 'staff-names';
        viewport.append(this.strip, this.names);

        new ResizeObserver(() => this.applyScroll(false)).observe(viewport);
    }

    render(composition: Composition) {
        this.composition = composition;
        this.layout = renderScore(this.score, composition, this.cache);
        const box = this.score.querySelector('svg')?.getBBox();
        this.drawn = {
            top: Math.min(0, box?.y ?? 0),
            bottom: Math.max(this.layout.height, box ? box.y + box.height : 0),
        };
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

        const top = layout.parts[selection.firstPart];
        const bottom = layout.parts[selection.lastPart];
        if (!top || !bottom) return undefined;
        const vertical = { top: top.top - 2 * SELECTION_PADDING, bottom: bottom.bottom + 2 * SELECTION_PADDING };

        if (selection.kind === 'measures') {
            const first = layout.measures[selection.first];
            const last = layout.measures[selection.last];
            if (!first || !last) return undefined;
            return { left: first.x, right: last.x + last.width, ...vertical };
        }

        const left = this.xAt(selection.start);
        const right = this.xAt(selection.end);
        if (left === undefined || right === undefined) return undefined;
        return { left: left - SELECTION_PADDING, right: right - SELECTION_PADDING, ...vertical };
    }

    /** Where a moment in a measure is drawn */
    private xAt({ measure, offset }: TimePoint): number | undefined {
        const anchors = this.layout?.measures[measure]?.anchors;
        return anchors?.length ? interpolate(anchors, toNumber(offset)) : undefined;
    }

    /** Draws insert mode's phantom note in place of the cursor's chord or rest; undefined clears it */
    setPhantom(phantom: Phantom | undefined, cursor: Cursor) {
        this.score.querySelector('.replacing')?.classList.remove('replacing');
        const x = this.layout?.leafX.get(leafElementId(cursor));
        if (!phantom || !this.layout || !this.composition || x === undefined) {
            this.phantomLayer.replaceChildren();
            return;
        }

        this.score.querySelector(`#${leafElementId(cursor)}`)?.classList.add('replacing');
        drawPhantom(this.phantomLayer, this.layout, phantom, {
            part: cursor.part,
            measure: cursor.measure,
            x,
            clef: clefAt(this.composition.parts[cursor.part] ?? { measures: [] }, cursor.measure),
            keySignature: resolveMeasures(this.composition.measures)[cursor.measure]?.keySignature ?? C_MAJOR,
        });
    }

    /** Scrolls to a measure, and up or down to a part's stave if they don't all fit */
    centerOn(measure: number, part = this.centeredPart) {
        if (measure === this.centeredMeasure && part === this.centeredPart) return;
        this.centeredMeasure = measure;
        this.centeredPart = part;
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

    /**
     * The score sits centered in the viewport. When it's taller, this moves the centered part's
     * stave to the middle instead, without scrolling past the top or bottom of the score.
     */
    private verticalOffset(): number {
        const { layout } = this;
        const stave = layout?.parts[this.centeredPart];
        const spare = layout ? layout.height - this.viewport.clientHeight : 0;
        if (!layout || !stave || spare <= 0) return 0;
        const toStave = layout.height / 2 - (stave.top + stave.bottom) / 2;
        return Math.max(-spare / 2, Math.min(spare / 2, toStave));
    }

    /**
     * Shows the staff names at the left edge, beside each stave, once the score is scrolled far
     * enough that its own names at the start are cut off. `left` and `top` are where the
     * score's top left corner is on screen.
     */
    private showPinnedNames(left: number, top: number, scale: number) {
        const { layout, composition } = this;
        const cut = layout && left + LEFT_MARGIN * scale < 0;
        this.names.hidden = !cut;
        if (!cut || !composition) return;

        const labels = composition.parts.map(({ name }, p) => {
            const stave = layout.parts[p]!;
            const label = document.createElement('div');
            label.textContent = name;
            label.style.top = `${top + ((stave.top + stave.bottom) / 2) * scale}px`;
            return label;
        });
        this.names.replaceChildren(...labels);
    }

    /**
     * Zooms out so every stave fits the viewport's height, or back to full size. Playback uses
     * it, so all the parts can be followed at once.
     */
    fitHeight(fit: boolean) {
        if (fit === this.fitting) return;
        this.fitting = fit;
        this.applyScroll(true);
    }

    /** How much the score is shrunk: below 1 only while fitting a score taller than the viewport */
    private scale(): number {
        const height = this.drawn.bottom - this.drawn.top;
        return this.fitting && height > this.viewport.clientHeight ? this.viewport.clientHeight / height : 1;
    }

    private applyScroll(animate: boolean) {
        const box = this.layout?.measures[this.centeredMeasure];
        if (!box || !this.layout) return;
        const scale = this.scale();
        // Scaled from the top left, so the measure's middle lands in the viewport's middle
        const x = this.viewport.clientWidth / 2 - (box.x + box.width / 2) * scale;
        // At full size the strip sits centered; shrunk, everything drawn is centered instead
        const viewportHeight = this.viewport.clientHeight;
        const top = (viewportHeight - this.layout.height) / 2;
        const { top: drawnTop, bottom: drawnBottom } = this.drawn;
        const y =
            scale < 1
                ? (viewportHeight - scale * (drawnBottom - drawnTop)) / 2 - scale * drawnTop - top
                : this.verticalOffset();
        this.strip.classList.toggle('animate', animate);
        this.strip.style.transformOrigin = '0 0';
        this.strip.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        this.showPinnedNames(x, y + (viewportHeight - this.layout.height) / 2, scale);
    }
}
