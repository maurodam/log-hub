import { Component, DOCUMENT, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCodeBlockImports } from '@spartan-ng/helm/code-block';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

export interface ApiKeyTokenContext {
  title: string;
  token: string;
}

/** Serilog configuration line for the Seq sink. */
export function serilogSnippet(origin: string, token: string): string {
  return `Log.Logger = new LoggerConfiguration()\n    .WriteTo.Seq("${origin}", apiKey: "${token}")\n    .CreateLogger();`;
}

/** One CLEF event posted with curl. */
export function curlSnippet(origin: string, token: string, now: Date): string {
  const event = JSON.stringify({
    '@t': now.toISOString(),
    '@mt': 'Hello from {Source}',
    Source: 'curl',
  });
  return [
    `curl -X POST "${origin}/ingest/clef" \\`,
    `  -H "Content-Type: application/vnd.serilog.clef" \\`,
    `  -H "X-Seq-ApiKey: ${token}" \\`,
    `  --data-binary '${event}'`,
  ].join('\n');
}

/** Shows a freshly created token once, with ready-to-paste client snippets. */
@Component({
  selector: 'app-api-key-token-dialog',
  imports: [HlmAlertImports, HlmButton, HlmCodeBlockImports, HlmDialogImports, NgIcon],
  providers: [provideIcons({ lucideTriangleAlert })],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>API key created</h2>
      <p hlmDialogDescription>{{ context.title }}</p>
    </hlm-dialog-header>

    <div hlmAlert>
      <ng-icon name="lucideTriangleAlert" class="text-amber-600 dark:text-amber-400" />
      <h3 hlmAlertTitle>Copy the token now</h3>
      <p hlmAlertDescription>
        It will not be shown again. Only a short prefix is stored for display.
      </p>
    </div>

    <div hlmCodeBlock>
      <hlm-code-block-header>
        <span hlmCodeBlockTitle>Token</span>
        <hlm-code-block-actions>
          <button hlmCodeBlockCopyButton [value]="context.token" copyText="Copy token"></button>
        </hlm-code-block-actions>
      </hlm-code-block-header>
      <pre hlmCodeBlockContent wrap [code]="context.token"></pre>
    </div>

    <div hlmCodeBlock size="sm">
      <hlm-code-block-header>
        <span hlmCodeBlockTitle>Serilog (C#)</span>
        <hlm-code-block-actions>
          <button hlmCodeBlockCopyButton [value]="serilog" copyText="Copy C# snippet"></button>
        </hlm-code-block-actions>
      </hlm-code-block-header>
      <pre hlmCodeBlockContent [code]="serilog"></pre>
    </div>

    <div hlmCodeBlock size="sm">
      <hlm-code-block-header>
        <span hlmCodeBlockTitle>curl (CLEF)</span>
        <hlm-code-block-actions>
          <button hlmCodeBlockCopyButton [value]="curl" copyText="Copy curl command"></button>
        </hlm-code-block-actions>
      </hlm-code-block-header>
      <pre hlmCodeBlockContent [code]="curl"></pre>
    </div>

    <hlm-dialog-footer>
      <button hlmBtn type="button" (click)="close()">Done</button>
    </hlm-dialog-footer>
  `,
})
export class ApiKeyTokenDialog {
  private readonly dialogRef = inject(BrnDialogRef);
  protected readonly context = injectBrnDialogContext<ApiKeyTokenContext>();
  private readonly origin = inject(DOCUMENT).location.origin;

  protected readonly serilog = serilogSnippet(this.origin, this.context.token);
  protected readonly curl = curlSnippet(this.origin, this.context.token, new Date());

  protected close(): void {
    this.dialogRef.close();
  }
}
