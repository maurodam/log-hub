import { Component, inject } from '@angular/core';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { EventList } from '../components/event-list';
import { EventsToolbar } from '../components/events-toolbar';
import { SignalsDock } from '../components/signals/signals-dock';
import { SignalsPanel } from '../components/signals/signals-panel';
import { EventsStore } from '../data-access/events-store';
import { SignalsPanelLayout } from '../data-access/signals-panel-layout';
import { SignalsStore } from '../data-access/signals-store';

@Component({
  selector: 'app-events-page',
  imports: [EventsToolbar, EventList, HlmSheetImports, SignalsDock, SignalsPanel],
  providers: [EventsStore, SignalsStore, SignalsPanelLayout],
  host: { class: 'flex min-h-0 flex-1 gap-3' },
  template: `
    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <app-events-toolbar />
      <app-event-list />
    </div>

    @if (layout.docked()) {
      <app-signals-dock />
    }

    <hlm-sheet
      side="right"
      autoFocus="[role=searchbox]"
      [state]="layout.sheetOpen() ? 'open' : 'closed'"
      (closed)="layout.sheetOpen.set(false)"
    >
      <hlm-sheet-content
        *hlmSheetPortal="let ctx"
        class="w-[min(22rem,92vw)] gap-0 p-0"
        [showCloseButton]="false"
      >
        <app-signals-panel class="h-full" (closed)="layout.close()" />
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class EventsPage {
  protected readonly layout = inject(SignalsPanelLayout);
}
