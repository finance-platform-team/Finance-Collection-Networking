/**
 * Simple static feature flags — flip the value and redeploy (`pac code push`).
 * No runtime toggle, no per-user config; that's intentionally as far as this goes
 * unless a real need for more shows up.
 */

import type { PageKey } from '../components/Layout';

/** When true, the sidebar (Layout.tsx) shows only the "Visits" nav section —
 * Collection Plan and Management are hidden entirely, not just collapsed. */
export const VISITS_ONLY = false;

/** Per-page sidebar visibility. A false page is dropped from the sidebar (and a
 * group with no enabled pages disappears); the app opens on the first enabled page. */
export const PAGE_ENABLED: Record<PageKey, boolean> = {
  'collection-plan': false,
  'daily-collection': false,
  'weekly-targets': false,
  'visit-plan': true,
  visits: true,
  'visit-audit': true,
  'activity-communication': false,
  accounts: true,
  agents: true,
  'dispute-management': false,
  sla: false,
  'high-risk-companies': false,
};
