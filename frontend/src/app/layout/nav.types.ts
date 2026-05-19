import { IconName } from '../ui/icon/icon-registry';

/**
 * Declarative sidebar navigation. AppComponent (or any feature) defines a
 * NavSection[] and passes it to <tm-sidebar [sections]="...">. The sidebar
 * is pure presentation — it doesn't know about your auth or routing logic.
 *
 * Each item can be:
 *   - a leaf link (has `route`, no `children`)
 *   - a group (has `children`, optionally collapsible)
 *
 * Use `visible` (set by the consumer) to gate items by permission BEFORE
 * passing the config in, or omit hidden items entirely.
 */
export interface NavItem {
  label: string;
  icon: IconName;
  route?: string;
  /** Optional query params appended to the route (e.g. {insights: 'leaderboard'}). */
  queryParams?: Record<string, string | number | boolean>;
  badge?: string | number;
  children?: NavItem[];
  /** Default-open state for a group. Defaults to false (collapsed). */
  initiallyOpen?: boolean;
}

export interface NavSection {
  /** Optional overline label above the group. */
  label?: string;
  items: NavItem[];
}
