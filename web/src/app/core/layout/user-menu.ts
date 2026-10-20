import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucideLogOut } from '@ng-icons/lucide';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { SessionService } from '../auth/session.service';

/** Two-letter initials from a display name (`Ada Lovelace` → `AL`, `admin` → `AD`). */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Avatar button with the signed-in user, "Change password" and "Sign out". */
@Component({
  selector: 'app-user-menu',
  imports: [HlmAvatarImports, HlmButton, HlmDropdownMenuImports, NgIcon],
  providers: [provideIcons({ lucideKeyRound, lucideLogOut })],
  template: `
    @if (session.user(); as user) {
      <button
        hlmBtn
        variant="ghost"
        size="sm"
        class="h-8 gap-2 px-1.5"
        align="end"
        [hlmDropdownMenuTrigger]="menu"
        [attr.aria-label]="'Account: ' + session.displayName()"
      >
        <hlm-avatar size="sm">
          <span hlmAvatarFallback class="bg-primary/10 text-primary text-[10px] font-semibold">
            {{ initials() }}
          </span>
        </hlm-avatar>
        <span class="hidden max-w-40 truncate text-sm font-medium sm:inline">
          {{ session.displayName() }}
        </span>
      </button>

      <ng-template #menu>
        <hlm-dropdown-menu class="w-60">
          <div class="flex flex-col gap-0.5 px-2 py-1.5">
            <span class="truncate text-sm font-medium">{{ session.displayName() }}</span>
            <span class="text-muted-foreground truncate text-xs">
              {{ user.email || user.username }}
              @if (user.authProvider === 'Oidc') {
                · single sign-on
              }
            </span>
          </div>
          <hlm-dropdown-menu-separator />
          @if (user.authProvider === 'Local') {
            <button hlmDropdownMenuItem (triggered)="changePassword()">
              <ng-icon name="lucideKeyRound" />
              Change password
            </button>
          }
          <button hlmDropdownMenuItem (triggered)="signOut()">
            <ng-icon name="lucideLogOut" />
            Sign out
          </button>
        </hlm-dropdown-menu>
      </ng-template>
    }
  `,
})
export class UserMenu {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly initials = computed(() => initials(this.session.displayName()));

  protected changePassword(): void {
    void this.router.navigateByUrl('/change-password');
  }

  protected async signOut(): Promise<void> {
    try {
      await this.session.logout();
    } catch {
      // The error toast is already shown; the local session is cleared anyway.
    }
    await this.router.navigateByUrl('/login');
  }
}
