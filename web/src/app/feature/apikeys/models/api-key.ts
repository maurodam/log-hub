import type { Permission } from '../../../core/auth/session.service';

/** Levels accepted as `minimumLevel` (null = accept everything). */
export const MINIMUM_LEVELS = [
  'Verbose',
  'Debug',
  'Information',
  'Warning',
  'Error',
  'Fatal',
] as const;
export type MinimumLevel = (typeof MINIMUM_LEVELS)[number];

/** POST/PUT /api/v1/apikeys body (docs/api/v1.md). */
export interface ApiKeyInput {
  title: string;
  permissions: Permission[];
  minimumLevel: MinimumLevel | null;
  appliedProperties: Record<string, unknown>;
  useServerTimestamps: boolean;
}

export interface ApiKey extends ApiKeyInput {
  id: number;
  tokenPrefix: string;
  isDefault: boolean;
  createdDate: string;
}

/** POST /api/v1/apikeys result. `token` is returned only here. */
export interface CreatedApiKey {
  apiKey: ApiKey;
  token: string;
}
