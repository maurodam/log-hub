import { Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

/** Centered placeholder for pages or lists without content. Icons must be provided by the caller. */
@Component({
  selector: 'app-empty-state',
  imports: [NgIcon],
  host: { class: 'flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center' },
  template: `
    @if (icon(); as icon) {
      <ng-icon [name]="icon" class="text-muted-foreground mb-2 text-4xl" />
    }
    <h2 class="text-lg font-semibold">{{ title() }}</h2>
    @if (description(); as description) {
      <p class="text-muted-foreground max-w-sm text-sm">{{ description }}</p>
    }
    <ng-content />
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly icon = input<string>();
}
