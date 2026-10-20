import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { ThemeService } from './core/layout/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmToasterImports],
  template: `
    <router-outlet />
    <hlm-toaster richColors closeButton [theme]="theme.isDark() ? 'dark' : 'light'" />
  `,
})
export class App {
  protected readonly theme = inject(ThemeService);
}
