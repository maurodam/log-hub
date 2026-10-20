import { Component, inject, Service, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  /** Red confirm button and warning icon (deletes). Default true. */
  destructive?: boolean;
  /**
   * Runs when the user confirms. The dialog shows a spinner, closes on success and stays open on
   * failure (the HTTP error toast explains why).
   */
  action?: () => Promise<unknown>;
}

/** Alert dialog content. Open it with `ConfirmDialogService.confirm()`. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [HlmAlertDialogImports, HlmSpinner, NgIcon],
  providers: [provideIcons({ lucideTriangleAlert })],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-alert-dialog-header>
      @if (destructive) {
        <hlm-alert-dialog-media class="bg-destructive/10 text-destructive">
          <ng-icon name="lucideTriangleAlert" />
        </hlm-alert-dialog-media>
      }
      <h2 hlmAlertDialogTitle>{{ options.title }}</h2>
      <p hlmAlertDialogDescription>{{ options.description }}</p>
    </hlm-alert-dialog-header>
    <hlm-alert-dialog-footer>
      <button hlmAlertDialogCancel [disabled]="busy()">Cancel</button>
      <button
        hlmAlertDialogAction
        [variant]="destructive ? 'destructive' : 'default'"
        [disabled]="busy()"
        (click)="confirm()"
      >
        @if (busy()) {
          <hlm-spinner />
        }
        {{ options.confirmLabel ?? 'Confirm' }}
      </button>
    </hlm-alert-dialog-footer>
  `,
})
export class ConfirmDialog {
  private readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly options = injectBrnDialogContext<ConfirmOptions>();
  protected readonly destructive = this.options.destructive ?? true;
  protected readonly busy = signal(false);

  protected async confirm(): Promise<void> {
    const action = this.options.action;
    if (!action) {
      this.dialogRef.close(true);
      return;
    }
    this.busy.set(true);
    try {
      await action();
      this.dialogRef.close(true);
    } catch {
      this.busy.set(false);
    }
  }
}

/** Opens a confirmation alert dialog. Resolves true when confirmed (and the action succeeded). */
@Service()
export class ConfirmDialogService {
  private readonly dialog = inject(HlmDialogService);

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<boolean, ConfirmOptions>(ConfirmDialog, {
      context: options,
      role: 'alertdialog',
      closeOnOutsidePointerEvents: false,
      showCloseButton: false,
      contentClass: 'sm:max-w-md',
    });
    return (await firstValueFrom(ref.closed$)) === true;
  }
}
