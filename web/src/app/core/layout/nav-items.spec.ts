import { activeNavItem, NavItem, visibleNavSections } from './nav-items';

const only =
  (...permissions: NavItem['permission'][]) =>
  (permission: NavItem['permission']) =>
    permissions.includes(permission);

describe('visibleNavSections', () => {
  it('keeps only permitted items and drops empty sections', () => {
    const sections = visibleNavSections(only('Read'));
    expect(sections.map((s) => s.id)).toEqual(['main']);
    expect(sections[0].items.map((i) => i.label)).toEqual(['Events', 'Dashboard', 'Alerts']);
  });

  it('labels the settings section', () => {
    const sections = visibleNavSections(only('Read', 'Project', 'Organization'));
    const settings = sections.find((s) => s.id === 'settings');
    expect(settings?.label).toBe('Settings');
    expect(settings?.items.map((i) => i.label)).toEqual(['API Keys', 'Users', 'Retention']);
  });
});

describe('activeNavItem', () => {
  it('matches nested paths and ignores query strings', () => {
    expect(activeNavItem('/events/42?x=1')?.label).toBe('Events');
    expect(activeNavItem('/apikeys')?.label).toBe('API Keys');
    expect(activeNavItem('/eventsx')).toBeUndefined();
  });
});
