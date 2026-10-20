import { FilterSpec } from '../../../shared/models/filter-spec';

/** Body of POST/PUT `/alerts` (docs/api/v1.md, Alerts). */
export interface AlertInput {
  title: string;
  description: string | null;
  signalId: number | null;
  filter: FilterSpec;
  threshold: number;
  windowMinutes: number;
  suppressionMinutes: number;
  recipients: string[];
  isEnabled: boolean;
}

export interface Alert extends AlertInput {
  id: number;
  lastCheckedDate: string | null;
  lastTriggeredDate: string | null;
  lastError: string | null;
}

/** Item of GET `/alerts/{id}/notifications`. */
export interface AlertNotification {
  id: number;
  alertId: number;
  triggeredDate: string;
  eventCount: number;
  recipients: string[];
  status: 'Sent' | 'Failed';
  error: string | null;
}

/** Item of GET `/signals` or GET `/apikeys/lookup`, reduced to what the alert pages show. */
export interface LookupOption {
  id: number;
  title: string;
}

export function toAlertInput(alert: Alert): AlertInput {
  return {
    title: alert.title,
    description: alert.description,
    signalId: alert.signalId,
    filter: alert.filter,
    threshold: alert.threshold,
    windowMinutes: alert.windowMinutes,
    suppressionMinutes: alert.suppressionMinutes,
    recipients: alert.recipients,
    isEnabled: alert.isEnabled,
  };
}
