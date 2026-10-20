import { Component, input, model } from '@angular/core';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { Role } from '../models/user';

let nextId = 0;

/** Multi-select of roles as a checkbox list showing each role's permissions. */
@Component({
  selector: 'app-role-picker',
  imports: [HlmCheckbox],
  template: `
    <fieldset class="grid gap-2">
      <legend class="mb-2 text-sm font-medium">Roles</legend>
      @for (role of roles(); track role.id) {
        <div class="flex items-start gap-2">
          <hlm-checkbox
            class="mt-0.5"
            [inputId]="prefix + role.id"
            [checked]="selected().includes(role.id)"
            (checkedChange)="toggle(role.id, $event)"
          />
          <label [for]="prefix + role.id" class="grid gap-0.5 text-sm leading-tight">
            <span class="font-medium">{{ role.title }}</span>
            <span class="text-muted-foreground text-xs">
              {{ role.description || role.permissions.join(', ') || 'No permissions' }}
            </span>
          </label>
        </div>
      } @empty {
        <p class="text-muted-foreground text-xs">No roles defined.</p>
      }
    </fieldset>
  `,
})
export class RolePicker {
  readonly roles = input.required<readonly Role[]>();
  readonly selected = model.required<number[]>();

  protected readonly prefix = `role-picker-${nextId++}-`;

  protected toggle(id: number, checked: boolean): void {
    this.selected.update((ids) => {
      const next = checked ? [...ids, id] : ids.filter((value) => value !== id);
      return this.roles()
        .map((role) => role.id)
        .filter((roleId) => next.includes(roleId));
    });
  }
}
