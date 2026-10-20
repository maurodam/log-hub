import { Component, computed, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronDown, lucideLoaderCircle } from '@ng-icons/lucide';
import type { BrnOverlayState } from '@spartan-ng/brain/overlay';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';

export interface MultiSelectOption {
  id: number;
  label: string;
  /** Muted text on the right (e.g. "shared"). */
  hint?: string;
  /** Options with the same group are listed under one header, in input order. */
  group?: string;
}

interface OptionGroup {
  name: string;
  options: MultiSelectOption[];
}

/**
 * Searchable multi-select in a popover: an outline button showing the selection, and a list of
 * checkable rows. Emits the new id list (sorted) on every change.
 */
@Component({
  selector: 'app-multi-select',
  imports: [HlmPopoverImports, HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideChevronDown, lucideLoaderCircle })],
  template: `
    <hlm-popover align="start" sideOffset="4" (stateChanged)="onStateChange($event)">
      <button
        hlmPopoverTrigger
        hlmBtn
        variant="outline"
        size="sm"
        [attr.aria-label]="label() + ': ' + summary()"
      >
        @if (icon(); as icon) {
          <ng-icon [name]="icon" class="text-muted-foreground" />
        }
        <span class="max-w-40 truncate">{{ summary() }}</span>
        @if (selected().length > 1) {
          <span
            class="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4 tabular-nums"
            >{{ selected().length }}</span
          >
        }
        <ng-icon name="lucideChevronDown" class="text-muted-foreground" />
      </button>

      <hlm-popover-content class="w-72 gap-1.5 p-1.5" *hlmPopoverPortal="let ctx">
        <input
          #box
          hlmInput
          type="search"
          class="h-8 text-sm"
          autocomplete="off"
          spellcheck="false"
          [attr.aria-label]="'Search ' + label()"
          [placeholder]="searchPlaceholder()"
          [value]="query()"
          (input)="query.set(box.value)"
        />
        <div class="max-h-72 overflow-y-auto" role="group" [attr.aria-label]="label()">
          @for (group of groups(); track group.name) {
            @if (group.name) {
              <div
                class="text-muted-foreground px-2 pt-2 pb-0.5 text-[11px] font-medium tracking-wide uppercase"
              >
                {{ group.name }}
              </div>
            }
            @for (option of group.options; track option.id) {
              @let checked = selectedSet().has(option.id);
              <button
                type="button"
                role="checkbox"
                class="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none"
                [attr.aria-checked]="checked"
                (click)="toggle(option.id)"
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border"
                  [class]="
                    checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input'
                  "
                  aria-hidden="true"
                >
                  @if (checked) {
                    <ng-icon name="lucideCheck" class="text-[12px]" />
                  }
                </span>
                <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
                @if (option.hint) {
                  <span class="text-muted-foreground shrink-0 text-xs">{{ option.hint }}</span>
                }
              </button>
            }
          } @empty {
            <p
              class="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm"
            >
              @if (loading()) {
                <ng-icon name="lucideLoaderCircle" class="motion-safe:animate-spin" />
                Loading…
              } @else {
                {{ query() ? 'No matches.' : emptyText() }}
              }
            </p>
          }
        </div>
        <div class="flex items-center justify-between border-t px-1 pt-1.5">
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ selected().length }} selected
          </span>
          <button
            hlmBtn
            variant="ghost"
            size="xs"
            [disabled]="!selected().length"
            (click)="selectedChange.emit([])"
          >
            Clear
          </button>
        </div>
      </hlm-popover-content>
    </hlm-popover>
  `,
})
export class MultiSelect {
  /** Accessible name and the button text when nothing is selected (e.g. "API keys"). */
  readonly label = input.required<string>();
  readonly options = input.required<readonly MultiSelectOption[]>();
  readonly selected = input.required<readonly number[]>();
  readonly icon = input<string>();
  readonly loading = input(false);
  readonly searchPlaceholder = input('Search…');
  readonly emptyText = input('Nothing to choose from.');
  readonly selectedChange = output<number[]>();
  /** Emits each time the popover opens (e.g. to refresh the options). */
  readonly opened = output();

  protected readonly query = signal('');
  protected readonly selectedSet = computed(() => new Set(this.selected()));

  protected readonly summary = computed(() => {
    const selected = this.selected();
    if (!selected.length) return this.label();
    if (selected.length > 1) return this.label();
    return this.options().find((option) => option.id === selected[0])?.label ?? `#${selected[0]}`;
  });

  protected readonly groups = computed<OptionGroup[]>(() => {
    const query = this.query().trim().toLowerCase();
    const groups: OptionGroup[] = [];
    for (const option of this.options()) {
      const haystack = `${option.label} ${option.hint ?? ''} ${option.group ?? ''}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      const name = option.group ?? '';
      let group = groups.find((g) => g.name === name);
      if (!group) groups.push((group = { name, options: [] }));
      group.options.push(option);
    }
    return groups;
  });

  protected toggle(id: number): void {
    const current = this.selected();
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    this.selectedChange.emit([...next].sort((a, b) => a - b));
  }

  protected onStateChange(state: BrnOverlayState): void {
    if (state === 'open') this.opened.emit();
    else this.query.set('');
  }
}
