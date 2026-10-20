import { Component, input } from '@angular/core';
import { APP_NAME } from '../config/app-config';

/** LogHub logo: stacked log lines in a rounded tile, plus the product name. */
@Component({
  selector: 'app-brand-mark',
  host: { class: 'flex items-center gap-2' },
  template: `
    <span
      class="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="2.25"
        stroke-linecap="round"
      >
        <path d="M5 7h3M11 7h8" />
        <path d="M5 12h8M16 12h3" opacity="0.75" />
        <path d="M5 17h2M10 17h6" opacity="0.5" />
      </svg>
    </span>
    @if (showName()) {
      <span
        class="truncate text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
        >{{ name }}</span
      >
    }
  `,
})
export class BrandMark {
  readonly showName = input(true);
  protected readonly name = APP_NAME;
}
