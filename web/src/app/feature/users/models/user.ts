import type { Permission } from '../../../core/auth/session.service';

/** GET /api/v1/users item (docs/api/v1.md). */
export interface User {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  /** `Local` or `Oidc`. */
  authProvider: string;
  isDisabled: boolean;
  mustChangePassword: boolean;
  roleIds: number[];
  lastLoginDate: string | null;
  lockoutEnd: string | null;
}

/** GET /api/v1/roles item. */
export interface Role {
  id: number;
  title: string;
  description: string | null;
  permissions: Permission[];
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  email: string | null;
  password: string;
  roleIds: number[];
  mustChangePassword: boolean;
}

export interface UpdateUserInput {
  displayName: string;
  email: string | null;
  roleIds: number[];
  isDisabled: boolean;
}

export interface ResetPasswordInput {
  newPassword: string;
  mustChangePassword: boolean;
}

export type UserStatus = 'active' | 'disabled' | 'locked';

/** Disabled wins over locked; locked means `lockoutEnd` is in the future. */
export function userStatus(user: Pick<User, 'isDisabled' | 'lockoutEnd'>, now: Date): UserStatus {
  if (user.isDisabled) return 'disabled';
  if (user.lockoutEnd && new Date(user.lockoutEnd).getTime() > now.getTime()) return 'locked';
  return 'active';
}

/** Empty or blank text becomes null (optional API fields). */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
