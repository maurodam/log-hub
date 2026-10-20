import { LogSignal } from '../../../shared/models/signal';
import {
  canManageSignal,
  describeCombination,
  groupSignals,
  normalizeGroupName,
  signalGroupNames,
  toggleId,
} from './signal-groups';

function signal(
  id: number,
  title: string,
  groupName: string | null,
  extra: Partial<LogSignal> = {},
): LogSignal {
  return {
    id,
    title,
    description: null,
    groupName,
    filter: {},
    isShared: true,
    isProtected: false,
    isOwn: false,
    ...extra,
  };
}

const ERRORS = signal(1, 'Errors', 'Level', { isProtected: true });
const WARNINGS = signal(2, 'Warnings', 'Level', { isProtected: true });
const EXCEPTIONS = signal(3, 'Exceptions', null, { isProtected: true });
const BILLING = signal(4, 'billing', 'App', {
  description: 'Billing service',
  isOwn: true,
  isShared: false,
});
const SHOP = signal(5, 'Shop', ' App ', { isOwn: true });
const SLOW = signal(6, 'Slow requests', '', { description: 'Over 2 s' });

const ALL = [ERRORS, SLOW, WARNINGS, SHOP, EXCEPTIONS, BILLING];

const shape = (groups: ReturnType<typeof groupSignals>) =>
  groups.map((group) => [group.name, group.signals.map((s) => s.id)]);

describe('groupSignals', () => {
  it('lists named groups alphabetically, then the ungrouped signals, titles sorted', () => {
    expect(shape(groupSignals(ALL))).toEqual([
      ['App', [4, 5]],
      ['Level', [1, 2]],
      [null, [3, 6]],
    ]);
  });

  it('treats blank group names as no group', () => {
    expect(normalizeGroupName('  ')).toBeNull();
    expect(normalizeGroupName(' Level ')).toBe('Level');
    expect(groupSignals([SLOW])[0].name).toBeNull();
  });

  it('searches title, description and group name case-insensitively', () => {
    expect(shape(groupSignals(ALL, 'BILL'))).toEqual([['App', [4]]]);
    expect(shape(groupSignals(ALL, 'over 2'))).toEqual([[null, [6]]]);
    expect(shape(groupSignals(ALL, 'level'))).toEqual([['Level', [1, 2]]]);
    expect(groupSignals(ALL, 'nothing like this')).toEqual([]);
  });

  it('returns no groups for no signals', () => {
    expect(groupSignals([])).toEqual([]);
  });
});

describe('signalGroupNames', () => {
  it('returns distinct trimmed names without blanks', () => {
    expect(signalGroupNames(ALL)).toEqual(['App', 'Level']);
  });
});

describe('toggleId', () => {
  it('adds and removes ids keeping them sorted', () => {
    expect(toggleId([5, 1], 3)).toEqual([1, 3, 5]);
    expect(toggleId([1, 3, 5], 3)).toEqual([1, 5]);
  });
});

describe('describeCombination', () => {
  it('joins the same group with OR and different groups with AND', () => {
    expect(describeCombination([ERRORS, WARNINGS, EXCEPTIONS])).toBe(
      '(Errors OR Warnings) AND Exceptions',
    );
    expect(describeCombination([ERRORS, WARNINGS])).toBe('Errors OR Warnings');
    expect(describeCombination([EXCEPTIONS, SLOW])).toBe('Exceptions AND Slow requests');
    expect(describeCombination([BILLING, SHOP])).toBe('billing OR Shop');
    expect(describeCombination([])).toBe('');
  });
});

describe('canManageSignal', () => {
  const none = { write: false, project: false };
  const write = { write: true, project: false };
  const project = { write: false, project: true };

  it('never allows built-in signals', () => {
    expect(canManageSignal(ERRORS, { write: true, project: true })).toBe(false);
  });

  it('allows own signals with Write and shared ones with Project', () => {
    expect(canManageSignal(BILLING, write)).toBe(true);
    expect(canManageSignal(BILLING, none)).toBe(false);
    expect(canManageSignal(SLOW, write)).toBe(false);
    expect(canManageSignal(SLOW, project)).toBe(true);
    expect(canManageSignal(SHOP, write)).toBe(true);
  });
});
