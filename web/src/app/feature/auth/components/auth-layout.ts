import { Component, input } from '@angular/core';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { BrandMark } from '../../../core/layout/brand-mark';
import { ThemeMenu } from '../../../core/layout/theme-menu';

/** Full-screen centered card used by the pages outside the shell (sign in, password change). */
@Component({
  selector: 'app-auth-layout',
  imports: [HlmCardImports, BrandMark, ThemeMenu],
  host: { class: 'bg-muted/40 relative flex min-h-svh flex-col items-center justify-center p-4' },
  template: `
    <div class="absolute end-3 top-3">
      <app-theme-menu />
    </div>
    <div class="flex w-full max-w-sm flex-col gap-6">
      <app-brand-mark class="justify-center" />
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle class="text-lg">{{ heading() }}</h1>
          @if (description(); as description) {
            <p hlmCardDescription>{{ description }}</p>
          }
        </div>
        <div hlmCardContent>
          <ng-content />
        </div>
      </section>
      <ng-content select="[authFooter]" />
    </div>
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly description = input<string>();
}
