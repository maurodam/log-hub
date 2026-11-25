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
  webhookDestinationIds?: number[];
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
  status: 'Sent' | 'Failed' | 'Pending' | 'Cancelled';
  destinationName?: string;
  kind?: string;
  attempts?: number;
  isTest?: boolean;
  error: string | null;
}

/** Item of GET `/signals` or GET `/apikeys/lookup`, reduced to what the alert pages show. */
export interface LookupOption {
  id: number;
  title: string;
}

export interface WebhookDestination {
  id: number;
  name: string;
  kind: 'teams' | 'slack' | 'generic';
  enabled: boolean;
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
    webhookDestinationIds: alert.webhookDestinationIds,
  };
}
