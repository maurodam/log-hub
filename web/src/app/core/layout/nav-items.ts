import {
  lucideBell,
  lucideDatabase,
  lucideKeyRound,
  lucideLayoutDashboard,
  lucideMail,
  lucideScrollText,
  lucideUsers,
} from '@ng-icons/lucide';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Permission required to see the item (see docs/api/v1.md). */
  permission: 'Read' | 'Project' | 'Organization' | 'System';
  section: 'main' | 'settings';
}

export interface NavSection {
  id: NavItem['section'];
  /** Group label shown in the sidebar; null for the unlabeled main group. */
  label: string | null;
  items: NavItem[];
}

export const NAV_ICONS = {
  lucideScrollText,
  lucideLayoutDashboard,
  lucideBell,
  lucideKeyRound,
  lucideUsers,
  lucideDatabase,
  lucideMail,
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Events',
    path: '/events',
    icon: 'lucideScrollText',
    permission: 'Read',
    section: 'main',
  },
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: 'lucideLayoutDashboard',
    permission: 'Read',
    section: 'main',
  },
  { label: 'Alerts', path: '/alerts', icon: 'lucideBell', permission: 'Read', section: 'main' },
  {
    label: 'API Keys',
    path: '/apikeys',
    icon: 'lucideKeyRound',
    permission: 'Project',
    section: 'settings',
  },
  {
    label: 'Users',
    path: '/users',
    icon: 'lucideUsers',
    permission: 'Organization',
    section: 'settings',
  },
  {
    label: 'Retention',
    path: '/retention',
    icon: 'lucideDatabase',
    permission: 'Project',
    section: 'settings',
  },
  { label: 'Email', path: '/email', icon: 'lucideMail', permission: 'System', section: 'settings' },
];

const SECTION_LABELS: Record<NavItem['section'], string | null> = {
  main: null,
  settings: 'Settings',
};

/** Sidebar sections with only the items the user may open; empty sections are dropped. */
export function visibleNavSections(
  hasPermission: (permission: NavItem['permission']) => boolean,
): NavSection[] {
  return (['main', 'settings'] as const)
    .map((id) => ({
      id,
      label: SECTION_LABELS[id],
      items: NAV_ITEMS.filter((item) => item.section === id && hasPermission(item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Nav item whose path is a prefix of `url` (`/events/123?x` → Events). */
export function activeNavItem(url: string): NavItem | undefined {
  const path = url.split(/[?#]/, 1)[0];
  return NAV_ITEMS.find((item) => path === item.path || path.startsWith(`${item.path}/`));
}
