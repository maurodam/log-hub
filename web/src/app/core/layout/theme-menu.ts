import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMonitor, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { ThemeMode, ThemeService } from './theme.service';

const OPTIONS: readonly { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: 'lucideSun' },
  { mode: 'dark', label: 'Dark', icon: 'lucideMoon' },
  { mode: 'system', label: 'System', icon: 'lucideMonitor' },
];

/** Header button choosing light, dark or system theme. */
@Component({
  selector: 'app-theme-menu',
  imports: [HlmButton, HlmDropdownMenuImports, HlmTooltip, NgIcon],
  providers: [provideIcons({ lucideSun, lucideMoon, lucideMonitor })],
  template: `
    <button
      hlmBtn
      variant="ghost"
      size="icon-sm"
      align="end"
      [hlmDropdownMenuTrigger]="menu"
      hlmTooltip="Theme"
      [attr.aria-label]="'Theme: ' + current().label"
    >
      <ng-icon [name]="theme.isDark() ? 'lucideMoon' : 'lucideSun'" />
    </button>

    <ng-template #menu>
      <hlm-dropdown-menu class="w-36">
        <hlm-dropdown-menu-label>Theme</hlm-dropdown-menu-label>
        <hlm-dropdown-menu-group>
          @for (option of options; track option.mode) {
            <button
              hlmDropdownMenuRadio
              [keepOpen]="false"
              [checked]="theme.mode() === option.mode"
              (triggered)="theme.set(option.mode)"
            >
              <ng-icon [name]="option.icon" />
              {{ option.label }}
              <hlm-dropdown-menu-radio-indicator />
            </button>
          }
        </hlm-dropdown-menu-group>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class ThemeMenu {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;
  protected readonly current = computed(
    () => OPTIONS.find((option) => option.mode === this.theme.mode()) ?? OPTIONS[2],
  );
}
