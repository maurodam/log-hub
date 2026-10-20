/** `GET /api/v1/stats/overview` (docs/api/v1.md, Stats). */
export interface StatsOverview {
  from: string;
  to: string;
  bucketSeconds: number;
  total: number;
  /** Error and Fatal events. */
  errors: number;
  warnings: number;
  exceptions: number;
  distinctEventTypes: number;
  /** One entry per bucket, oldest first; empty buckets have zeros. */
  series: StatsBucket[];
  /** Non-zero levels only. */
  levels: LevelCount[];
  /** At most 10, highest count first. */
  topEventTypes: EventTypeCount[];
  /** At most 10, highest count first; non-zero only. */
  apiKeys: ApiKeyCount[];
}

export interface StatsBucket {
  start: string;
  total: number;
  errors: number;
  warnings: number;
}

export interface LevelCount {
  level: string;
  levelRank: number;
  count: number;
}

export interface EventTypeCount {
  eventType: string;
  messageTemplate: string | null;
  levelRank: number;
  count: number;
}

export interface ApiKeyCount {
  apiKeyId: number;
  title: string;
  count: number;
}

/** Share of `count` in `total` as a percentage (0 when total is 0). */
export function percentOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}
