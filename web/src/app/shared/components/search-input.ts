import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch, lucideX } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';

/**
 * Search box that emits `search` after a pause in typing (`debounceMs`), immediately on Enter,
 * and with an empty string when cleared. `shortcutKey` focuses it from anywhere on the page.
 */
@Component({
  selector: 'app-search-input',
  imports: [HlmInputGroupImports, HlmKbd, NgIcon],
  providers: [provideIcons({ lucideSearch, lucideX })],
  host: { '(document:keydown)': 'onDocumentKeydown($event)' },
  template: `
    <div hlmInputGroup>
      <div hlmInputGroupAddon>
        <ng-icon name="lucideSearch" />
      </div>
      <input
        #box
        hlmInputGroupInput
        type="text"
        role="searchbox"
        enterkeyhint="search"
        autocomplete="off"
        spellcheck="false"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        [value]="draft()"
        (input)="onInput(box.value)"
        (keydown.enter)="commit()"
        (keydown.escape)="onEscape($event)"
      />
      <div hlmInputGroupAddon align="inline-end">
        @if (draft()) {
          <button hlmInputGroupButton size="icon-xs" aria-label="Clear search" (click)="clear()">
            <ng-icon name="lucideX" />
          </button>
        } @else if (shortcutKey(); as key) {
          <kbd hlmKbd>{{ key }}</kbd>
        }
      </div>
    </div>
  `,
})
export class SearchInput {
  readonly value = input('');
  readonly placeholder = input('Search…');
  readonly label = input('Search');
  readonly debounceMs = input(300);
  readonly shortcutKey = input<string | null>(null);
  readonly search = output<string>();

  protected readonly draft = linkedSignal(() => this.value());
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onInput(text: string): void {
    this.draft.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), this.debounceMs());
  }

  protected commit(): void {
    clearTimeout(this.timer);
    const text = this.draft().trim();
    if (text !== this.value()) this.search.emit(text);
  }

  protected clear(): void {
    this.draft.set('');
    this.commit();
    this.box().nativeElement.focus();
  }

  protected onEscape(event: Event): void {
    if (!this.draft()) return;
    event.preventDefault();
    this.clear();
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    const key = this.shortcutKey();
    if (!key || event.key !== key || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;
    event.preventDefault();
    this.box().nativeElement.focus();
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
