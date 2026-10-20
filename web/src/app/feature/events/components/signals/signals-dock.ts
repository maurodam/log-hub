import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  SignalsPanelLayout,
} from '../../data-access/signals-panel-layout';
import { SignalsPanel } from './signals-panel';

const KEYBOARD_STEP = 16;

/** Docked, resizable signals column (wide screens). Drag the left edge or use arrow keys. */
@Component({
  selector: 'app-signals-dock',
  imports: [SignalsPanel],
  host: {
    class: 'bg-card relative flex shrink-0 flex-col rounded-lg border',
    role: 'complementary',
    'aria-label': 'Signals',
    '[style.width.px]': 'layout.width()',
  },
  template: `
    <div
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize signals panel"
      [attr.aria-valuenow]="layout.width()"
      [attr.aria-valuemin]="minWidth"
      [attr.aria-valuemax]="maxWidth"
      class="group/handle absolute inset-y-0 -start-2.5 z-10 flex w-2.5 cursor-col-resize touch-none justify-center outline-none"
      (pointerdown)="startResize($event)"
      (keydown.arrowleft)="resizeBy(KEYBOARD_STEP, $event)"
      (keydown.arrowright)="resizeBy(-KEYBOARD_STEP, $event)"
    >
      <span
        class="group-hover/handle:bg-primary/30 group-focus-visible/handle:bg-primary/50 my-3 w-0.5 rounded-full transition-colors"
        [class]="dragging() ? 'bg-primary/50' : ''"
      ></span>
    </div>
    <app-signals-panel class="min-h-0 flex-1" (closed)="layout.close()" />
  `,
})
export class SignalsDock {
  protected readonly layout = inject(SignalsPanelLayout);
  protected readonly minWidth = PANEL_MIN_WIDTH;
  protected readonly maxWidth = PANEL_MAX_WIDTH;
  protected readonly KEYBOARD_STEP = KEYBOARD_STEP;

  protected readonly dragging = signal(false);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging.set(true);
    const startX = event.clientX;
    const startWidth = this.layout.width();
    // Document listeners (not pointer capture) so the drag keeps working over any element.
    const move = (e: PointerEvent) => this.layout.setWidth(startWidth + startX - e.clientX);
    let unregister = () => {};
    const end = () => {
      unregister();
      this.document.removeEventListener('pointermove', move);
      this.document.removeEventListener('pointerup', end);
      this.document.removeEventListener('pointercancel', end);
      this.dragging.set(false);
      this.layout.persist();
    };
    this.document.addEventListener('pointermove', move);
    this.document.addEventListener('pointerup', end);
    this.document.addEventListener('pointercancel', end);
    unregister = this.destroyRef.onDestroy(end);
  }

  protected resizeBy(delta: number, event: Event): void {
    event.preventDefault();
    this.layout.setWidth(this.layout.width() + delta);
    this.layout.persist();
  }
}
