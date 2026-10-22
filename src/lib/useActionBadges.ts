import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadMonth } from './activityComm';
import { computeActions, groupMessages, myIdsOf, roleOn, scopeMonth } from './actionItems';
import { useCurrentUser } from './useCurrentUser';
import type { Region } from './useRegion';

export interface MonthBadge {
  year: number;
  month: number;
  count: number;
}

const REFRESH_MS = 5 * 60 * 1000;

function badgeMonths(): { year: number; month: number }[] {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return [
    { year: now.getFullYear(), month: now.getMonth() + 1 },
    // Next month too — plans are usually set (and confirmed) before it starts.
    { year: next.getFullYear(), month: next.getMonth() + 1 },
  ];
}

const keyOf = (year: number, month: number) => `${year}-${month}`;

/**
 * Sidebar badge for Activity Communication: how many threads are waiting on
 * the signed-in user this month and next (see actionItems.ts for what counts).
 * Quiet by design — no popups; it refreshes when the page is entered or left,
 * on window focus and every few minutes. While the page is open it reports its live count for the
 * month it shows (`report`), so the badge drops the moment an item is handled.
 */
export function useActionBadges(region: Region | null, page: string) {
  const ctx = useCurrentUser();
  const [loaded, setLoaded] = useState<MonthBadge[]>([]);
  const [live, setLive] = useState<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  // Reload on entering/leaving the page (picks up what was handled there), not
  // on every navigation between unrelated pages.
  const onPage = page === 'activity-communication';

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const id = setInterval(bump, REFRESH_MS);
    window.addEventListener('focus', bump);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', bump);
    };
  }, []);

  useEffect(() => {
    const user = ctx.user;
    if (ctx.loading || ctx.error || !user) return;
    let cancelled = false;
    const myIds = myIdsOf(user);
    Promise.all(
      badgeMonths().map(async ({ year, month }) => {
        const data = await loadMonth(year, month, ctx.agents, ctx.employeeNames);
        const summary = computeActions(scopeMonth(data, user, ctx.agents, region), groupMessages(data.messages), myIds, (t) => roleOn(user, t));
        return { year, month, count: summary.badge };
      })
    )
      .then((months) => {
        if (cancelled) return;
        setLoaded(months);
        setLive(new Map());
      })
      // A badge is a hint, not data the user works from — keep the last value.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ctx.loading, ctx.error, ctx.user, ctx.agents, ctx.employeeNames, region, onPage, tick]);

  const report = useCallback((year: number, month: number, count: number) => {
    setLive((prev) => {
      const key = keyOf(year, month);
      if (prev.get(key) === count) return prev;
      const next = new Map(prev);
      next.set(key, count);
      return next;
    });
  }, []);

  const months = useMemo(
    () => loaded.map((m) => ({ ...m, count: live.get(keyOf(m.year, m.month)) ?? m.count })),
    [loaded, live]
  );
  const total = months.reduce((s, m) => s + m.count, 0);

  return { months, total, report };
}
