import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideEllipsis,
  lucideLock,
  lucidePencil,
  lucideTrash2,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { LogSignal } from '../../../../shared/models/signal';

/** One selectable signal. Clicking toggles it; the menu offers edit and delete when allowed. */
@Component({
  selector: 'app-signal-item',
  imports: [HlmButton, HlmDropdownMenuImports, HlmTooltip, NgIcon],
  providers: [
    provideIcons({
      lucideCheck,
      lucideEllipsis,
      lucideLock,
      lucidePencil,
      lucideTrash2,
      lucideUser,
      lucideUsers,
    }),
  ],
  host: {
    class: 'group relative flex items-start rounded-md',
    '[class]': "selected() ? 'bg-primary/[0.07] dark:bg-primary/10' : 'hover:bg-muted/70'",
  },
  template: `
    @if (selected()) {
      <span
        class="bg-primary absolute inset-y-1 start-0 w-0.5 rounded-full"
        aria-hidden="true"
      ></span>
    }
    <button
      type="button"
      role="checkbox"
      class="focus-visible:ring-ring/60 flex min-w-0 flex-1 items-start gap-2 rounded-md py-1.5 ps-2.5 pe-1 text-left outline-none focus-visible:ring-2"
      [attr.aria-checked]="selected()"
      [attr.aria-describedby]="signal().description ? descriptionId() : null"
      (click)="toggled.emit()"
    >
      <span
        class="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border"
        [class]="selected() ? 'bg-primary border-primary text-primary-foreground' : 'border-input'"
        aria-hidden="true"
      >
        @if (selected()) {
          <ng-icon name="lucideCheck" class="text-[10px]" />
        }
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[13px] leading-5" [class.font-medium]="selected()">{{
          signal().title
        }}</span>
        @if (signal().description; as description) {
          <span class="text-muted-foreground block truncate text-xs" [attr.id]="descriptionId()">{{
            description
          }}</span>
        }
      </span>
      <ng-icon
        class="text-muted-foreground/80 mt-1 shrink-0 text-xs"
        role="img"
        [name]="marker().icon"
        [attr.aria-label]="marker().label"
        [hlmTooltip]="marker().label"
      />
    </button>
    @if (canManage()) {
      <button
        hlmBtn
        variant="ghost"
        size="icon-xs"
        class="mt-1 me-0.5 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        align="end"
        [hlmDropdownMenuTrigger]="menu"
        [attr.aria-label]="'Actions for ' + signal().title"
      >
        <ng-icon name="lucideEllipsis" />
      </button>
      <ng-template #menu>
        <hlm-dropdown-menu class="w-40">
          <button hlmDropdownMenuItem (triggered)="edit.emit()">
            <ng-icon name="lucidePencil" />
            Edit…
          </button>
          <button hlmDropdownMenuItem variant="destructive" (triggered)="remove.emit()">
            <ng-icon name="lucideTrash2" />
            Delete…
          </button>
        </hlm-dropdown-menu>
      </ng-template>
    }
  `,
})
export class SignalItem {
  readonly signal = input.required<LogSignal>();
  readonly selected = input(false);
  readonly canManage = input(false);
  readonly toggled = output();
  readonly edit = output();
  readonly remove = output();

  protected readonly descriptionId = computed(() => `signal-description-${this.signal().id}`);
  protected readonly marker = computed(() => {
    const signal = this.signal();
    if (signal.isProtected) return { icon: 'lucideLock', label: 'Built-in shared signal' };
    return signal.isShared
      ? { icon: 'lucideUsers', label: 'Shared with everyone' }
      : { icon: 'lucideUser', label: 'Personal: only you see it' };
  });
}
