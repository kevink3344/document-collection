export const MENU_LABEL_KEYS = ['dashboard', 'collections', 'records', 'reports', 'settings', 'tickets'] as const
export type MenuLabelKey = typeof MENU_LABEL_KEYS[number]

export const DEFAULT_MENU_LABELS: Record<MenuLabelKey, string> = {
  dashboard: 'Dashboard',
  collections: 'Collections',
  records: 'Records',
  reports: 'Reports',
  settings: 'Settings',
  tickets: 'Tickets',
}

export const MENU_LABEL_MAX_LENGTH = 40
