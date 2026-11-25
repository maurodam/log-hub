import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog';
import { serverErrorMessage } from '../../shared/utils/server-error';
import { QueryApi, queryRange, QueryResult, SavedDashboard } from './query-api';
import { QueryResultView } from './query-result';

@Component({
  imports: [FormsModule, HlmButton, HlmInput, QueryResultView, RouterLink],
  host: { class: 'grid gap-4' },
  template: `
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Saved dashboards</h2>
      <a hlmBtn variant="outline" routerLink="/query">Query events</a>
    </header>
    <div class="flex flex-wrap items-end gap-2">
      <label class="grid gap-1 text-sm"
        >Dashboard
        <select
          [ngModel]="selected()?.id ?? 0"
          (ngModelChange)="open($event)"
          class="bg-background rounded-md border px-3 py-2"
        >
          <option [ngValue]="0">Select a dashboard</option>
          @for (item of dashboards(); track item.id) {
            <option [ngValue]="item.id">{{ item.name }}</option>
          }
        </select>
      </label>
      @if (canEdit()) {
        <button hlmBtn variant="outline" (click)="startNew()">New dashboard</button>
        @if (selected(); as dashboard) {
          <button hlmBtn variant="outline" (click)="edit(dashboard)">Edit dashboard</button>
          <button hlmBtn variant="outline" (click)="remove(dashboard)">Delete</button>
        }
      }
      @if (selected()) {
        <button hlmBtn variant="outline" [disabled]="loading()" (click)="refresh()">
          Refresh widgets
        </button>
      }
    </div>
    @if (resource.error()) {
      <p class="text-destructive text-sm" role="alert">Could not load dashboards.</p>
      <button hlmBtn variant="outline" (click)="resource.reload()">Retry</button>
    } @else if (resource.isLoading() && !resource.hasValue()) {
      <p class="text-muted-foreground text-sm" role="status">Loading dashboards…</p>
    } @else if (!dashboards().length && !draft()) {
      <p class="text-muted-foreground text-sm">No dashboards have been saved.</p>
    }

    @if (draft(); as form) {
      <form #editor="ngForm" class="grid gap-4 rounded-lg border p-4" (ngSubmit)="save(form)">
        <label class="grid gap-1 text-sm"
          >Dashboard name
          <input hlmInput name="name" [(ngModel)]="form.name" required maxlength="100" />
        </label>
        @for (widget of form.widgets; track widget; let index = $index) {
          <fieldset class="grid gap-2 rounded-lg border p-3">
            <legend class="px-1 text-sm font-medium">Widget {{ index + 1 }}</legend>
            <label class="grid gap-1 text-sm"
              >Title
              <input
                hlmInput
                [name]="'title' + index"
                [(ngModel)]="widget.title"
                required
                maxlength="100"
              />
            </label>
            <label class="grid gap-1 text-sm"
              >Expression
              <textarea
                [name]="'expression' + index"
                [(ngModel)]="widget.expression"
                rows="2"
                maxlength="4096"
                class="bg-background rounded-md border p-2 font-mono text-sm"
              ></textarea>
            </label>
            <div class="flex flex-wrap items-end gap-2">
              <label class="grid gap-1 text-sm"
                >Period in hours
                <input
                  hlmInput
                  type="number"
                  [name]="'hours' + index"
                  min="1"
                  max="720"
                  [(ngModel)]="widget.hours"
                  required
                />
              </label>
              <label class="grid gap-1 text-sm"
                >Visualization
                <select
                  class="bg-background rounded-md border px-3 py-2"
                  [name]="'view' + index"
                  [(ngModel)]="widget.view"
                >
                  <option value="number">Number</option>
                  <option value="table">Table</option>
                  <option value="series">Time series</option>
                </select>
              </label>
              <button
                hlmBtn
                type="button"
                variant="outline"
                (click)="form.widgets.splice(index, 1)"
              >
                Remove widget
              </button>
            </div>
          </fieldset>
        }
        <div class="flex flex-wrap gap-2">
          <button
            hlmBtn
            type="button"
            variant="outline"
            [disabled]="form.widgets.length >= 12"
            (click)="
              form.widgets.push({
                title: '',
                expression: 'SELECT count()',
                hours: 24,
                view: 'number',
              })
            "
          >
            Add widget
          </button>
          <button hlmBtn type="submit" [disabled]="editor.invalid || saving()">
            Save dashboard
          </button>
          <button hlmBtn type="button" variant="outline" (click)="draft.set(null)">Cancel</button>
        </div>
      </form>
    }

    @if (selected(); as dashboard) {
      @if (!dashboard.widgets.length) {
        <p class="text-muted-foreground text-sm">This dashboard has no widgets.</p>
      }
      @if (loading()) {
        <p class="text-muted-foreground text-sm" role="status">Loading widgets…</p>
      }
      <div class="grid gap-3 lg:grid-cols-2">
        @for (widget of dashboard.widgets; track $index; let index = $index) {
          <section class="min-w-0 rounded-lg border p-3">
            <h3 class="break-words font-semibold">{{ widget.title }}</h3>
            <p class="text-muted-foreground mb-2 text-xs">Last {{ widget.hours }} h</p>
            @if (results()[index]; as entry) {
              @if ('result' in entry) {
                <app-query-result [result]="entry.result" [view]="widget.view" />
              } @else {
                <p class="text-destructive text-sm" role="alert">{{ entry.error }}</p>
              }
            }
          </section>
        }
      </div>
    }
  `,
})
export class SavedDashboardPage {
  private readonly api = inject(QueryApi);
  private readonly session = inject(SessionService);
  private readonly confirm = inject(ConfirmDialogService);
  private generation = 0;
  protected readonly resource = httpResource<SavedDashboard[]>(() => this.api.dashboardsUrl);
  protected readonly dashboards = computed(() =>
    this.resource.hasValue() ? (this.resource.value() ?? []) : [],
  );
  protected readonly selected = signal<SavedDashboard | null>(null);
  protected readonly draft = signal<SavedDashboard | null>(null);
  protected readonly results = signal<({ result: QueryResult } | { error: string })[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly canEdit = computed(() => this.session.hasPermission('Project'));

  protected open(id: number) {
    this.draft.set(null);
    this.selected.set(this.dashboards().find((dashboard) => dashboard.id === id) ?? null);
    void this.refresh();
  }

  protected startNew() {
    this.draft.set({ id: 0, name: '', widgets: [], revision: 0 });
  }

  protected edit(dashboard: SavedDashboard) {
    this.draft.set(structuredClone(dashboard));
  }

  protected async save(dashboard: SavedDashboard) {
    this.saving.set(true);
    try {
      this.selected.set(await firstValueFrom(this.api.save(dashboard)));
      this.draft.set(null);
      this.resource.reload();
      void this.refresh();
    } catch {
      // The HTTP error interceptor shows the server message.
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(dashboard: SavedDashboard) {
    void this.confirm.confirm({
      title: `Delete “${dashboard.name}”?`,
      description: 'This removes the shared dashboard and its widgets.',
      confirmLabel: 'Delete dashboard',
      action: async () => {
        await firstValueFrom(this.api.delete(dashboard));
        this.open(0);
        this.resource.reload();
      },
    });
  }

  protected async refresh() {
    const generation = ++this.generation;
    const widgets = this.selected()?.widgets ?? [];
    this.results.set([]);
    this.loading.set(widgets.length > 0);
    const entries = await Promise.all(
      widgets.map(async (widget) => {
        try {
          return {
            result: await firstValueFrom(this.api.run(widget.expression, queryRange(widget.hours))),
          };
        } catch (error) {
          return { error: serverErrorMessage(error, 'The widget query could not be run.') };
        }
      }),
    );
    if (generation === this.generation) {
      this.results.set(entries);
      this.loading.set(false);
    }
  }
}
