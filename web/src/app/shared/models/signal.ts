import { FilterSpec } from './filter-spec';

/**
 * Saved, named event filter (docs/api/v1.md, Signals). Called `LogSignal` so it does not clash
 * with Angular's `Signal`.
 */
export interface LogSignal {
  id: number;
  title: string;
  description: string | null;
  /** Signals in the same group combine with OR; different groups (or no group) with AND. */
  groupName: string | null;
  filter: FilterSpec;
  isShared: boolean;
  /** Built-in signals cannot be changed or deleted. */
  isProtected: boolean;
  /** Created by the current user. */
  isOwn: boolean;
}

/** Body of `POST /signals` and `PUT /signals/{id}`. */
export interface SignalInput {
  title: string;
  description: string | null;
  groupName: string | null;
  filter: FilterSpec;
  isShared: boolean;
}
