import { computed, DestroyRef, DOCUMENT, effect, inject, Service, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const STORAGE_KEY = 'loghub.theme';

/** Light / dark / system theme. Toggles the `dark` class on `<html>`, persisted in localStorage. */
@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly mode = signal<ThemeMode>(readStored());
  readonly isDark = computed(
    () => this.mode() === 'dark' || (this.mode() === 'system' && this.systemDark()),
  );

  constructor() {
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));

    this.apply(this.isDark());
    effect(() => this.apply(this.isDark()));
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (privacy mode): the choice lasts for this page only.
    }
  }

  private apply(dark: boolean): void {
    this.document.documentElement.classList.toggle('dark', dark);
  }
}

function readStored(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEME_MODES.find((mode) => mode === stored) ?? 'system';
  } catch {
    return 'system';
  }
}
