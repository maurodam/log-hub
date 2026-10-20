import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { lucideShieldOff } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { homePath } from '../../../core/auth/auth.guards';
import { SessionService } from '../../../core/auth/session.service';
import { EmptyState } from '../../../shared/components/empty-state';

/** Shown inside the shell when the user lacks the permission of the requested page. */
@Component({
  selector: 'app-forbidden-page',
  imports: [EmptyState, HlmButton, RouterLink],
  providers: [provideIcons({ lucideShieldOff })],
  template: `
    <app-empty-state
      icon="lucideShieldOff"
      title="No access"
      description="Your account does not have permission to open this page. Ask an administrator for access."
    >
      @if (home(); as home) {
        <a hlmBtn variant="outline" class="mt-2" [routerLink]="home">Go to start page</a>
      }
    </app-empty-state>
  `,
})
export class ForbiddenPage {
  private readonly session = inject(SessionService);

  protected readonly home = computed(() => {
    const path = homePath((permission) => this.session.hasPermission(permission));
    return path === '/forbidden' ? null : path;
  });
}
