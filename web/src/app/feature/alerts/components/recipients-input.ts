import {
  Component,
  computed,
  ElementRef,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { addRecipients, MAX_RECIPIENTS } from '../models/recipients';

const SEPARATOR_KEYS = new Set(['Enter', ',', ';', ' ']);

/**
 * Email chips input. Enter, comma, semicolon, space or leaving the field turns the typed text
 * into chips; pasted lists are split. Invalid entries stay in the box with a message.
 */
@Component({
  selector: 'app-recipients-input',
  imports: [NgIcon],
  providers: [provideIcons({ lucideX })],
  host: { class: 'grid gap-1' },
  template: `
    <div
      class="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex min-h-8 cursor-text flex-wrap items-center gap-1 rounded-lg border bg-transparent px-1 py-1 transition-colors focus-within:ring-3"
      [class.border-destructive]="invalid() && touched()"
      [class.opacity-50]="disabled()"
      (click)="focus()"
    >
      @for (address of value(); track address) {
        <span
          class="bg-secondary text-secondary-foreground inline-flex h-6 max-w-full items-center gap-0.5 rounded-md ps-2 pe-0.5 font-mono text-xs"
        >
          <span class="truncate">{{ address }}</span>
          <button
            type="button"
            class="hover:bg-foreground/10 focus-visible:ring-ring/50 rounded p-0.5 outline-none focus-visible:ring-2"
            [attr.aria-label]="'Remove ' + address"
            [disabled]="disabled()"
            (click)="remove(address); $event.stopPropagation()"
          >
            <ng-icon name="lucideX" class="text-[12px]" />
          </button>
        </span>
      }
      <input
        #box
        type="text"
        inputmode="email"
        autocomplete="off"
        spellcheck="false"
        class="placeholder:text-muted-foreground h-6 min-w-44 flex-1 bg-transparent px-1.5 text-sm outline-none disabled:cursor-not-allowed"
        [id]="inputId()"
        [placeholder]="full() ? 'Recipient limit reached' : 'name@example.com, then Enter'"
        [disabled]="disabled() || full()"
        [value]="draft()"
        [attr.aria-invalid]="(invalid() && touched()) || !!entryError() || null"
        [attr.aria-describedby]="inputId() + '-hint'"
        (input)="draft.set(box.value); entryError.set(null)"
        (keydown)="onKeydown($event)"
        (paste)="onPaste($event)"
        (blur)="commit(); touch.emit()"
      />
    </div>
    <div class="flex items-start gap-2 text-xs" [id]="inputId() + '-hint'">
      @if (entryError(); as error) {
        <p class="text-destructive" role="alert">{{ error }}</p>
      } @else {
        <p class="text-muted-foreground">Separate addresses with Enter, comma or space.</p>
      }
      <span class="text-muted-foreground ms-auto shrink-0 tabular-nums">
        {{ value().length }} / {{ limit }}
      </span>
    </div>
  `,
})
export class RecipientsInput implements FormValueControl<string[]> {
  readonly value = model<string[]>([]);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly touch = output<void>();
  readonly inputId = input('recipients');

  protected readonly limit = MAX_RECIPIENTS;
  protected readonly draft = signal('');
  protected readonly entryError = signal<string | null>(null);
  protected readonly full = computed(() => this.value().length >= MAX_RECIPIENTS);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  focus(): void {
    this.box().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (SEPARATOR_KEYS.has(event.key)) {
      if (event.key !== 'Enter' || this.draft().trim()) event.preventDefault();
      this.commit();
    } else if (event.key === 'Backspace' && !this.draft() && this.value().length) {
      event.preventDefault();
      this.remove(this.value()[this.value().length - 1]);
    }
  }

  protected onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/[\s,;]/.test(text.trim())) return;
    event.preventDefault();
    this.draft.update((draft) => `${draft} ${text}`);
    this.commit();
  }

  protected commit(): void {
    if (!this.draft().trim()) return;
    const result = addRecipients(this.value(), this.draft());
    this.value.set(result.recipients);
    this.draft.set(result.rejected.join(', '));
    this.entryError.set(result.error);
  }

  protected remove(address: string): void {
    this.value.update((list) => list.filter((item) => item !== address));
    this.entryError.set(null);
  }
}
