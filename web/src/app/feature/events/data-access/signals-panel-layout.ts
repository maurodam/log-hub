import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

/** Screens at least this wide dock the panel next to the list; narrower ones use a sheet. */
const WIDE_QUERY = '(min-width: 1024px)';
const STORAGE_KEY = 'loghub.events.signals-panel';
export const PANEL_MIN_WIDTH = 220;
export const PANEL_MAX_WIDTH = 520;
const PANEL_DEFAULT_WIDTH = 280;

interface StoredLayout {
  open?: unknown;
  width?: unknown;
}

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}

/**
 * Where the signals panel is shown: docked (wide screens, collapsible, resizable; remembered
 * in localStorage) or in a sheet (narrow screens).
 */
@Injectable()
export class SignalsPanelLayout {
  private readonly media = typeof matchMedia === 'function' ? matchMedia(WIDE_QUERY) : null;
  private readonly stored = readStored();

  readonly wide = signal(this.media?.matches ?? true);
  /** Docked panel visible (wide screens only). */
  readonly open = signal(this.stored.open !== false);
  readonly width = signal(
    typeof this.stored.width === 'number'
      ? clampPanelWidth(this.stored.width)
      : PANEL_DEFAULT_WIDTH,
  );
  /** Sheet visible (narrow screens only). */
  readonly sheetOpen = signal(false);
  readonly docked = computed(() => this.wide() && this.open());
  /** Panel visible in either form; drives the toolbar button state. */
  readonly visible = computed(() => this.docked() || this.sheetOpen());

  constructor() {
    const media = this.media;
    if (media) {
      const onChange = (event: MediaQueryListEvent) => this.wide.set(event.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
    // A sheet left open while the window grows would cover the docked panel.
    effect(() => {
      if (this.wide()) this.sheetOpen.set(false);
    });
  }

  toggle(): void {
    if (this.wide()) {
      this.open.update((open) => !open);
      this.persist();
    } else {
      this.sheetOpen.update((open) => !open);
    }
  }

  close(): void {
    if (this.wide()) {
      this.open.set(false);
      this.persist();
    } else {
      this.sheetOpen.set(false);
    }
  }

  setWidth(width: number): void {
    this.width.set(clampPanelWidth(width));
  }

  persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ open: this.open(), width: this.width() } satisfies StoredLayout),
      );
    } catch {
      // Storage unavailable (private mode, quota): the layout just is not remembered.
    }
  }
}

function readStored(): StoredLayout {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredLayout) : {};
  } catch {
    return {};
  }
}
