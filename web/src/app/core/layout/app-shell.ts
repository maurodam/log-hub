import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { filter, map } from 'rxjs';
import { SessionService } from '../auth/session.service';
import { BrandMark } from './brand-mark';
import { activeNavItem, NAV_ICONS, visibleNavSections } from './nav-items';
import { ThemeMenu } from './theme-menu';
import { UserMenu } from './user-menu';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    HlmSidebarImports,
    BrandMark,
    ThemeMenu,
    UserMenu,
  ],
  providers: [provideIcons(NAV_ICONS)],
  templateUrl: './app-shell.html',
})
export class AppShell {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Sidebar groups filtered by the user's permissions. */
  protected readonly sections = computed(() =>
    visibleNavSections((permission) => this.session.hasPermission(permission)),
  );

  protected readonly pageTitle = computed(() => activeNavItem(this.url())?.label ?? '');
}
