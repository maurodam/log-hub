import { Component, computed, input } from '@angular/core';

/** The part of a Signal Forms field state this component reads. */
export interface FieldStateLike {
  touched(): boolean;
  invalid(): boolean;
  errors(): readonly { kind: string; message?: string }[];
}

/**
 * First validation message of a Signal Forms field, shown once the field is touched
 * (blur or submit). Usage: `<app-field-error [field]="myForm.title" />`.
 */
@Component({
  selector: 'app-field-error',
  host: { class: 'contents' },
  template: `
    @if (message(); as message) {
      <p role="alert" class="text-destructive text-xs">{{ message }}</p>
    }
  `,
})
export class FieldError {
  readonly field = input.required<() => FieldStateLike>();

  protected readonly message = computed(() => {
    const state = this.field()();
    if (!state.touched() || !state.invalid()) return null;
    return state.errors()[0]?.message ?? 'Invalid value.';
  });
}

/** True when a touched field has errors, for `[forceInvalid]` styling on inputs. */
export function showFieldError(field: () => FieldStateLike): boolean {
  const state = field();
  return state.touched() && state.invalid();
}
