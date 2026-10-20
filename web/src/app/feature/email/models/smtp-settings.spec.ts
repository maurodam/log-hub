import {
  isHttpUrl,
  isValidPort,
  SmtpSettings,
  smtpModelChanged,
  toSmtpInput,
  toSmtpModel,
} from './smtp-settings';

const settings: SmtpSettings = {
  host: 'smtp.example.com',
  port: 587,
  username: 'loghub',
  hasPassword: true,
  security: 'StartTls',
  fromAddress: 'loghub@example.com',
  fromName: 'LogHub',
  publicUrl: 'https://logs.example.com',
  isConfigured: true,
  isFromEnvironment: false,
};

describe('toSmtpInput', () => {
  it('sends null to keep the stored password', () => {
    expect(toSmtpInput(toSmtpModel(settings)).password).toBeNull();
  });

  it('sends a new password and trims text fields', () => {
    const input = toSmtpInput({
      ...toSmtpModel(settings),
      host: ' mail.example.com ',
      password: 's3cret',
      fromName: '  ',
      publicUrl: 'https://logs.example.com/',
    });
    expect(input).toEqual({
      host: 'mail.example.com',
      port: 587,
      username: 'loghub',
      password: 's3cret',
      security: 'StartTls',
      fromAddress: 'loghub@example.com',
      fromName: null,
      publicUrl: 'https://logs.example.com',
    });
  });
});

describe('smtpModelChanged', () => {
  it('detects edits, ignoring surrounding spaces', () => {
    const model = toSmtpModel(settings);
    expect(smtpModelChanged(model, settings)).toBe(false);
    expect(smtpModelChanged({ ...model, host: 'smtp.example.com ' }, settings)).toBe(false);
    expect(smtpModelChanged({ ...model, port: 465 }, settings)).toBe(true);
    expect(smtpModelChanged({ ...model, password: 'x' }, settings)).toBe(true);
  });
});

describe('validators', () => {
  it('checks ports', () => {
    expect(isValidPort(25)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
    expect(isValidPort(null)).toBe(false);
  });

  it('checks public URLs', () => {
    expect(isHttpUrl('https://logs.example.com')).toBe(true);
    expect(isHttpUrl('http://10.0.0.5:5000')).toBe(true);
    expect(isHttpUrl('logs.example.com')).toBe(false);
    expect(isHttpUrl('ftp://x')).toBe(false);
  });
});
