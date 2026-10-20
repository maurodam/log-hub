import { Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideRefreshCw } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';

/** Destructive alert for a failed load, with a Retry button. */
@Component({
  selector: 'app-load-error',
  imports: [HlmAlertImports, HlmButton, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideRefreshCw })],
  template: `
    <div hlmAlert variant="destructive">
      <ng-icon name="lucideCircleAlert" />
      <h3 hlmAlertTitle>{{ title() }}</h3>
      <p hlmAlertDescription>
        {{ message() || 'The server did not answer. Check the connection and retry.' }}
      </p>
      <div hlmAlertAction>
        <button hlmBtn variant="outline" size="sm" (click)="retry.emit()">
          <ng-icon name="lucideRefreshCw" />
          Retry
        </button>
      </div>
    </div>
  `,
})
export class LoadError {
  readonly title = input('Could not load data');
  readonly message = input<string | null | undefined>();
  readonly retry = output();
}
