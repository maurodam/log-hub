import { Component, input } from '@angular/core';

/** Page title, optional description, and actions projected on the right. */
@Component({
  selector: 'app-page-header',
  host: { class: 'flex flex-wrap items-start justify-between gap-3' },
  template: `
    <div class="grid gap-0.5">
      <h2 class="text-lg font-semibold tracking-tight">{{ heading() }}</h2>
      @if (description(); as description) {
        <p class="text-muted-foreground text-sm">{{ description }}</p>
      }
    </div>
    <div class="flex items-center gap-2">
      <ng-content />
    </div>
  `,
})
export class PageHeader {
  readonly heading = input.required<string>();
  readonly description = input<string>();
}
