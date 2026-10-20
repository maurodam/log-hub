export type SmtpSecurity = 'None' | 'StartTls' | 'SslOnConnect';

export interface SmtpSecurityOption {
  value: SmtpSecurity;
  label: string;
  /** Usual port for this mode. */
  port: number;
}

export const SMTP_SECURITY_OPTIONS: readonly SmtpSecurityOption[] = [
  { value: 'None', label: 'None (plain SMTP)', port: 25 },
  { value: 'StartTls', label: 'STARTTLS', port: 587 },
  { value: 'SslOnConnect', label: 'SSL/TLS on connect', port: 465 },
];

/** GET/PUT `/settings/smtp` result (docs/api/v1.md, SMTP settings). */
export interface SmtpSettings {
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  security: SmtpSecurity;
  fromAddress: string | null;
  fromName: string | null;
  publicUrl: string | null;
  isConfigured: boolean;
  isFromEnvironment: boolean;
}

/** Body of PUT `/settings/smtp`. `password: null` keeps the stored password. */
export interface SmtpSettingsInput {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  security: SmtpSecurity;
  fromAddress: string;
  fromName: string | null;
  publicUrl: string | null;
}

/** Editable form state: plain strings, empty when unset. */
export interface SmtpModel {
  host: string;
  port: number | null;
  security: SmtpSecurity;
  username: string;
  /** New password; empty keeps the stored one. */
  password: string;
  fromAddress: string;
  fromName: string;
  publicUrl: string;
}

export function toSmtpModel(settings: SmtpSettings | null | undefined): SmtpModel {
  return {
    host: settings?.host ?? '',
    port: settings?.port ?? 587,
    security: settings?.security ?? 'StartTls',
    username: settings?.username ?? '',
    password: '',
    fromAddress: settings?.fromAddress ?? '',
    fromName: settings?.fromName ?? '',
    publicUrl: settings?.publicUrl ?? '',
  };
}

const orNull = (value: string) => value.trim() || null;

export function toSmtpInput(model: SmtpModel): SmtpSettingsInput {
  return {
    host: model.host.trim(),
    port: model.port ?? 0,
    username: orNull(model.username),
    // Empty means "keep the stored password" (the API treats null that way).
    password: model.password ? model.password : null,
    security: model.security,
    fromAddress: model.fromAddress.trim(),
    fromName: orNull(model.fromName),
    publicUrl: orNull(model.publicUrl)?.replace(/\/+$/, '') ?? null,
  };
}

/** True when saving `model` would change the stored settings. */
export function smtpModelChanged(
  model: SmtpModel,
  settings: SmtpSettings | null | undefined,
): boolean {
  const saved = toSmtpModel(settings);
  return (Object.keys(saved) as (keyof SmtpModel)[]).some((key) =>
    typeof saved[key] === 'string'
      ? String(model[key]).trim() !== String(saved[key]).trim()
      : model[key] !== saved[key],
  );
}

export function isValidPort(port: number | null): boolean {
  return port !== null && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Accepts absolute http(s) URLs such as `https://logs.example.com`. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}
