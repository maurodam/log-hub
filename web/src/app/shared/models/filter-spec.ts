/** Structured event filter stored by signals and alerts (docs/api/v1.md, FilterSpec). */
export interface FilterSpec {
  text?: string | null;
  levels?: string[] | null;
  /** `Name=Value` entries. */
  properties?: string[] | null;
  apiKeyIds?: number[] | null;
  hasException?: boolean | null;
  traceId?: string | null;
  eventType?: string | null;
}
