import { Component, inject } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

export interface ConfirmDialogContext {
  title: string;
  description: string;
  confirmLabel: string;
}

/** Yes/no question for destructive actions. Closes with true when confirmed. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [HlmDialogImports, HlmButton],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ context.title }}</h2>
      <p hlmDialogDescription>{{ context.description }}</p>
    </hlm-dialog-header>
    <hlm-dialog-footer>
      <button hlmBtn variant="outline" (click)="dialogRef.close(false)">Cancel</button>
      <button hlmBtn variant="destructive" (click)="dialogRef.close(true)">
        {{ context.confirmLabel }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class ConfirmDialog {
  protected readonly context = injectBrnDialogContext<ConfirmDialogContext>();
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
}
