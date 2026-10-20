import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { SessionService } from '../../../core/auth/session.service';
import { errorMessage } from '../../../core/http/http-error';
import { SignalsApi } from '../../../shared/data-access/signals.api';
import { LogSignal } from '../../../shared/models/signal';
import { canManageSignal, signalGroupNames, SignalPermissions } from '../models/signal-groups';

/** Signals shown on the events page, plus the caller's permissions on them. */
@Injectable()
export class SignalsStore {
  private readonly api = inject(SignalsApi);
  private readonly session = inject(SessionService);

  private readonly resource = rxResource({ stream: () => this.api.list() });

  readonly signals = computed<readonly LogSignal[]>(() =>
    this.resource.hasValue() ? this.resource.value() : [],
  );
  readonly loading = computed(() => this.resource.isLoading() && !this.resource.hasValue());
  readonly error = computed(() => {
    const error = this.resource.error();
    return error ? (errorMessage(error) ?? 'Could not load signals.') : null;
  });
  readonly byId = computed(() => new Map(this.signals().map((signal) => [signal.id, signal])));
  readonly groupNames = computed(() => signalGroupNames(this.signals()));

  readonly permissions = computed<SignalPermissions>(() => ({
    write: this.session.hasPermission('Write'),
    project: this.session.hasPermission('Project'),
  }));
  readonly canCreate = computed(() => this.permissions().write);
  readonly canShare = computed(() => this.permissions().project);

  canManage(signal: LogSignal): boolean {
    return canManageSignal(signal, this.permissions());
  }

  reload(): void {
    this.resource.reload();
  }

  /** Puts a created or updated signal into the list without a round trip. */
  upsert(signal: LogSignal): void {
    if (!this.resource.hasValue()) {
      this.reload();
      return;
    }
    this.resource.update((list = []) => {
      const index = list.findIndex((item) => item.id === signal.id);
      return index < 0 ? [...list, signal] : list.map((item, i) => (i === index ? signal : item));
    });
  }

  delete(signal: LogSignal): Observable<void> {
    return this.api
      .delete(signal.id)
      .pipe(
        tap(() =>
          this.resource.update((list = []) => list.filter((item) => item.id !== signal.id)),
        ),
      );
  }
}
