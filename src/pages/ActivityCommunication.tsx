import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import AgentPicker from '../components/AgentPicker';
import MonthPicker from '../components/MonthPicker';
import ThreadPanel, { OutcomePill, StatusPill, type ThreadTarget } from '../components/ThreadPanel';
import { useCurrentUser, type UserRole } from '../lib/useCurrentUser';
import {
  MSG_CHANGE_RECOMMENDATION,
  MSG_COMMENT,
  MSG_CONFIRMATION_REQUEST,
  MSG_SYSTEM_EVENT,
  OBJECTIVES,
  ROLE_AGENT,
  ROLE_MANAGER,
  STATUS_CHANGE_REQUESTED,
  STATUS_CONFIRMED,
  STATUS_PENDING,
  THREAD_FEEDBACK,
  THREAD_PLANNING,
  createMessage,
  fmtDateRange,
  fmtShortDate,
  initials,
  loadMonth,
  markRead,
  mixSummary,
  updateConfirmation,
  updateReviewed,
  type ActivityRow,
  type Actor,
  type ConfirmationStatus,
  type Message,
  type MonthData,
  type NewMessage,
  type ObjectiveMix,
  type PlanRow,
} from '../lib/activityComm';
import {
  activityGroupKey,
  computeActions,
  groupMessages,
  isOwnActivity as isOwnActivityOf,
  myIdsOf,
  planGroupKey,
  roleOn,
  scopeMonth,
  threadKeyOf,
  unreadFor,
  type ActionItem,
} from '../lib/actionItems';
import type { MonthBadge } from '../lib/useActionBadges';
import type { PageKey } from '../components/Layout';
import type { Region } from '../lib/useRegion';
import './ActivityCommunication.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Tab = 'plan' | 'feedback';

interface ActivityCommunicationPageProps {
  region: Region | null;
  onNavigate?: (page: PageKey) => void;
  /** App-wide "waiting on you" counts (this month and next) — used to point at
   *  the other month when it has items and the one on screen doesn't. */
  monthBadges?: MonthBadge[];
  /** Reports this page's live count for the month on screen to the sidebar badge. */
  onActionCount?: (year: number, month: number, count: number) => void;
}


export default function ActivityCommunicationPage({ region, onNavigate, monthBadges, onActionCount }: ActivityCommunicationPageProps) {
  const ctx = useCurrentUser();
  const [devRole, setDevRole] = useState<UserRole | null>(null);
  const [ym, setYm] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 }));
  const [tab, setTab] = useState<Tab>('plan');
  // Manager-only: narrow both tabs (and their KPI cards) to one agent, by hr_employee id.
  const [agentFilter, setAgentFilter] = useState('');
  // Keyed by `${year}-${month}` so a stale month's result is never shown as
  // the current one — "loading" is simply "nothing loaded for this key yet".
  const [loaded, setLoaded] = useState<{ key: string; data: MonthData | null; error: string | null } | null>(null);
  const [selected, setSelected] = useState<{ kind: 'plan' | 'activity'; id: string } | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempSeq = useRef(0);

  const user = ctx.user;
  // Page-level role (filters, scope). A user can be an agent and a manager at
  // once, so actions use roleFor(row): on their own rows they are the Agent
  // (confirm / recommend, no self-review), on everyone else's the Manager.
  const role: UserRole = devRole ?? user?.role ?? 'manager';
  const monthLabel = `${MONTHS[ym.month - 1]} ${ym.year}`;
  const monthKey = `${ym.year}-${ym.month}`;
  const current = loaded?.key === monthKey ? loaded : null;
  const data = current?.data ?? null;
  const loadError = current?.error ?? null;
  const loading = !current;

  const actor: Actor | null = user ? { systemUserId: user.systemUserId, employeeId: user.employeeId, agentId: user.agentIds[0] || '' } : null;
  const myIds = useMemo(() => myIdsOf(user), [user]);

  const isOwnActivity = useCallback((a: ActivityRow) => isOwnActivityOf(user, a), [user]);
  const roleFor = useCallback((t: ThreadTarget): UserRole => devRole ?? roleOn(user, t), [devRole, user]);
  const senderRoleOf = (r: UserRole) => (r === 'agent' ? ROLE_AGENT : ROLE_MANAGER);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  useEffect(() => {
    if (ctx.loading || ctx.error) return;
    let cancelled = false;
    const key = `${ym.year}-${ym.month}`;
    loadMonth(ym.year, ym.month, ctx.agents, ctx.employeeNames)
      .then((d) => {
        if (!cancelled) setLoaded({ key, data: d, error: null });
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [ym, ctx.loading, ctx.error, ctx.agents, ctx.employeeNames]);

  // ---- scope: an agent sees only their own rows, a manager their team, then
  // the app-wide Region. The dev-only role toggle doesn't narrow scope, so
  // either side can be tested.
  const visible = useMemo(() => scopeMonth(data, user, ctx.agents, region, !!devRole), [data, user, devRole, region, ctx.agents]);

  const agentOptions = useMemo(() => {
    const names = new Map<string, string>();
    visible.plans.forEach((p) => p.employeeId && names.set(p.employeeId, p.ownerName));
    const agentNameByEmployee = new Map(ctx.agents.map((a) => [a.employeeId, a.name]));
    visible.activities.forEach((a) =>
      a.employeeIds.forEach((id) => {
        if (!names.has(id)) names.set(id, ctx.employeeNames.get(id) || agentNameByEmployee.get(id) || '(agent)');
      })
    );
    return Array.from(names.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visible, ctx.agents, ctx.employeeNames]);
  const activeAgentFilter = role === 'manager' && agentOptions.some((o) => o.id === agentFilter) ? agentFilter : '';
  const scoped = useMemo(
    () =>
      activeAgentFilter
        ? {
            plans: visible.plans.filter((p) => p.employeeId === activeAgentFilter),
            activities: visible.activities.filter((a) => a.employeeIds.includes(activeAgentFilter)),
          }
        : visible,
    [visible, activeAgentFilter]
  );

  const plans = scoped.plans;
  const activities = scoped.activities;

  const messagesByThread = useMemo(() => groupMessages(data?.messages || []), [data?.messages]);
  const unreadIn = useCallback(
    (t: ThreadTarget) => unreadFor(messagesByThread.get(threadKeyOf(t)) || [], myIds, roleFor(t)),
    [messagesByThread, myIds, roleFor]
  );

  // "Waiting on you": the whole scope feeds the sidebar badge; the agent
  // filter (manager) narrows what the strip, tabs and groups show.
  const allActions = useMemo(() => computeActions(visible, messagesByThread, myIds, roleFor), [visible, messagesByThread, myIds, roleFor]);
  const actions = useMemo(
    () => (activeAgentFilter ? computeActions(scoped, messagesByThread, myIds, roleFor) : allActions),
    [activeAgentFilter, scoped, messagesByThread, myIds, roleFor, allActions]
  );
  useEffect(() => {
    // Only real data in the user's own role should move the sidebar badge.
    if (!loading && data && !devRole) onActionCount?.(ym.year, ym.month, allActions.badge);
  }, [loading, data, devRole, ym, allActions.badge, onActionCount]);
  const unreadPlan = useCallback((p: PlanRow) => unreadIn({ kind: 'plan', row: p }).length, [unreadIn]);
  const unreadActivity = useCallback((a: ActivityRow) => unreadIn({ kind: 'activity', row: a }).length, [unreadIn]);

  // One group per task owner (by employee), weeks in week order underneath.
  const planGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; weeks: PlanRow[]; planned: number; pending: number; confirmed: number; change: number; unread: number }>();
    plans.forEach((p) => {
      const key = planGroupKey(p);
      let g = map.get(key);
      if (!g) {
        g = { key, name: p.ownerName, weeks: [], planned: 0, pending: 0, confirmed: 0, change: 0, unread: 0 };
        map.set(key, g);
      }
      g.weeks.push(p);
      g.planned += p.plan;
      if (p.status === STATUS_CONFIRMED) g.confirmed++;
      else if (p.status === STATUS_CHANGE_REQUESTED) g.change++;
      else g.pending++;
      g.unread += unreadPlan(p);
    });
    const groups = Array.from(map.values());
    groups.forEach((g) => g.weeks.sort((a, b) => a.weekNumber - b.weekNumber));
    return groups.sort((a, b) => Number(actions.groupKeys.has(b.key)) - Number(actions.groupKeys.has(a.key)) || a.name.localeCompare(b.name));
  }, [plans, unreadPlan, actions.groupKeys]);
  // Activities grouped by their primary task owner (double visits list under
  // Task Owner 1 and show both names on the row), newest first within a group.
  const activityGroups = useMemo(() => {
    const nameByAgent = new Map(ctx.agents.map((a) => [a.id, a.name]));
    const map = new Map<string, { key: string; name: string; rows: ActivityRow[]; reviewed: number; notReviewed: number; unread: number }>();
    activities.forEach((a) => {
      const primary = a.agentIds[0] || '';
      const key = activityGroupKey(a);
      let g = map.get(key);
      if (!g) {
        g = { key, name: (primary && nameByAgent.get(primary)) || a.agentName.split(' & ')[0] || '—', rows: [], reviewed: 0, notReviewed: 0, unread: 0 };
        map.set(key, g);
      }
      g.rows.push(a);
      if (a.reviewed) g.reviewed++;
      else g.notReviewed++;
      g.unread += unreadActivity(a);
    });
    const groups = Array.from(map.values());
    groups.forEach((g) => g.rows.sort((x, y) => y.date.localeCompare(x.date)));
    return groups.sort((x, y) => Number(actions.groupKeys.has(y.key)) - Number(actions.groupKeys.has(x.key)) || x.name.localeCompare(y.name));
  }, [activities, ctx.agents, unreadActivity, actions.groupKeys]);
  // Groups holding something that waits on you start open, the rest collapsed.
  // Once the user toggles a group or works in it, that choice is pinned here —
  // so a group doesn't snap shut the moment its last item is handled.
  const [pinnedOwners, setPinnedOwners] = useState<Map<string, boolean>>(new Map());
  const isOwnerOpen = (key: string) => pinnedOwners.get(key) ?? actions.groupKeys.has(key);
  function pinOwner(key: string, open: boolean) {
    setPinnedOwners((prev) => (prev.get(key) === open ? prev : new Map(prev).set(key, open)));
  }
  function toggleOwner(key: string) {
    pinOwner(key, !isOwnerOpen(key));
  }
  const groupKeyOf = (t: ThreadTarget) => (t.kind === 'plan' ? planGroupKey(t.row) : activityGroupKey(t.row));

  const planStats = useMemo(() => {
    const s = { planned: 0, owners: new Set<string>(), pending: 0, confirmed: 0, change: 0 };
    scoped.plans.forEach((p) => {
      s.planned += p.plan;
      s.owners.add(p.employeeId);
      if (p.status === STATUS_CONFIRMED) s.confirmed++;
      else if (p.status === STATUS_CHANGE_REQUESTED) s.change++;
      else s.pending++;
    });
    return s;
  }, [scoped.plans]);
  const feedbackStats = useMemo(() => {
    const reviewed = scoped.activities.filter((a) => a.reviewed).length;
    const unread = scoped.activities.reduce((s, a) => s + unreadActivity(a), 0);
    return { logged: scoped.activities.length, reviewed, notReviewed: scoped.activities.length - reviewed, unread };
  }, [scoped.activities, unreadActivity]);

  const target: ThreadTarget | null = useMemo(() => {
    if (!selected || !data) return null;
    if (selected.kind === 'plan') {
      const row = data.plans.find((p) => p.id === selected.id);
      return row ? { kind: 'plan', row } : null;
    }
    const row = data.activities.find((a) => a.id === selected.id);
    return row ? { kind: 'activity', row } : null;
  }, [selected, data]);
  const threadKey = target ? `${target.kind}:${target.row.id}` : '';
  const threadMessages = useMemo(() => (threadKey ? messagesByThread.get(threadKey) || [] : []), [threadKey, messagesByThread]);

  // ---- local state patches ----
  const patchData = useCallback((fn: (d: MonthData) => MonthData) => {
    setLoaded((l) => (l?.data ? { ...l, data: fn(l.data) } : l));
  }, []);
  const patchPlan = useCallback((id: string, patch: Partial<PlanRow>) => {
    patchData((d) => ({ ...d, plans: d.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }, [patchData]);
  const patchActivity = useCallback((id: string, patch: Partial<ActivityRow>) => {
    patchData((d) => ({ ...d, activities: d.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, [patchData]);
  const patchMessages = useCallback((fn: (list: Message[]) => Message[]) => {
    patchData((d) => ({ ...d, messages: fn(d.messages) }));
  }, [patchData]);

  /** Selects a row and marks the other side's messages in its thread as read. */
  function openThread(t: ThreadTarget) {
    setSelected({ kind: t.kind, id: t.row.id });
    pinOwner(groupKeyOf(t), true);
    const unread = unreadIn(t).map((m) => m.id);
    if (!unread.length) return;
    const ids = new Set(unread);
    patchMessages((list) => list.map((m) => (ids.has(m.id) ? { ...m, isRead: true } : m)));
    markRead(unread).catch((e) => {
      patchMessages((list) => list.map((m) => (ids.has(m.id) ? { ...m, isRead: false } : m)));
      showToast(e instanceof Error ? e.message : 'Could not mark messages as read.');
    });
  }

  function openAction(item: ActionItem) {
    const t = item.target;
    setTab(t.kind === 'plan' ? 'plan' : 'feedback');
    openThread(t);
  }

  /** Optimistically appends a message, then swaps in the saved one (or
   *  removes it and toasts on failure). Resolves false on failure. */
  async function postMessage(m: Omit<NewMessage, 'senderRole' | 'sender'>, asRole: UserRole): Promise<boolean> {
    const myRole = senderRoleOf(asRole);
    const tempId = `temp-${++tempSeq.current}`;
    const optimistic: Message = {
      id: tempId,
      threadType: m.threadType,
      planWeekId: m.planWeekId || '',
      activityId: m.activityId || '',
      senderId: user?.systemUserId || user?.employeeId || '',
      senderName: user?.name || '',
      senderRole: myRole,
      type: m.type,
      body: m.body,
      suggestedMix: m.suggestedMix || null,
      isRead: false,
      createdOn: new Date().toISOString(),
      pending: true,
    };
    patchMessages((list) => [...list, optimistic]);
    try {
      const saved = await createMessage({ ...m, senderRole: myRole, sender: actor || undefined });
      patchMessages((list) => list.map((x) => (x.id === tempId ? { ...saved, senderName: optimistic.senderName } : x)));
      return true;
    } catch (e) {
      patchMessages((list) => list.filter((x) => x.id !== tempId));
      showToast(e instanceof Error ? e.message : 'Could not send the message.');
      return false;
    }
  }

  function threadFields(t: ThreadTarget): Pick<NewMessage, 'threadType' | 'planWeekId' | 'activityId' | 'achievementId'> {
    return t.kind === 'plan'
      ? { threadType: THREAD_PLANNING, planWeekId: t.row.id, achievementId: t.row.achievementId || data?.defaultAchievementId }
      : { threadType: THREAD_FEEDBACK, activityId: t.row.id, achievementId: t.row.achievementId || data?.defaultAchievementId };
  }

  function onSend(body: string) {
    if (!target) return;
    void postMessage({ ...threadFields(target), type: MSG_COMMENT, body }, roleFor(target));
  }

  async function setStatus(row: PlanRow, status: ConfirmationStatus, message: Omit<NewMessage, 'senderRole' | 'sender' | 'threadType'>, asRole: UserRole) {
    const prev = { status: row.status, agentConfirmed: row.agentConfirmed, confirmedOn: row.confirmedOn, confirmedByName: row.confirmedByName };
    const confirmed = status === STATUS_CONFIRMED;
    patchPlan(row.id, {
      status,
      agentConfirmed: confirmed,
      confirmedOn: confirmed ? new Date().toISOString() : '',
      confirmedByName: confirmed ? user?.name || '' : '',
    });
    try {
      const on = await updateConfirmation(row.id, status, actor);
      if (confirmed) patchPlan(row.id, { confirmedOn: on });
    } catch (e) {
      patchPlan(row.id, prev);
      showToast(e instanceof Error ? e.message : 'Could not update the confirmation.');
      return;
    }
    await postMessage({ threadType: THREAD_PLANNING, ...message }, asRole);
  }

  function onToggleConfirm(row: PlanRow, confirmed: boolean) {
    if (roleFor({ kind: 'plan', row }) !== 'agent') return;
    const who = user?.name || 'Agent';
    void setStatus(row, confirmed ? STATUS_CONFIRMED : STATUS_PENDING, {
      planWeekId: row.id,
      achievementId: row.achievementId || data?.defaultAchievementId,
      type: MSG_SYSTEM_EVENT,
      body: confirmed ? `${who} confirmed Week ${row.weekNumber} objectives` : `${who} withdrew the Week ${row.weekNumber} confirmation`,
    }, 'agent');
  }

  function onRecommend(row: PlanRow, mix: ObjectiveMix, note: string) {
    if (roleFor({ kind: 'plan', row }) !== 'agent') return;
    void setStatus(row, STATUS_CHANGE_REQUESTED, {
      planWeekId: row.id,
      achievementId: row.achievementId || data?.defaultAchievementId,
      type: MSG_CHANGE_RECOMMENDATION,
      body: note || `I'd suggest a different mix for Week ${row.weekNumber}.`,
      suggestedMix: mix,
    }, 'agent');
  }

  function onAskReconfirm(row: PlanRow) {
    if (roleFor({ kind: 'plan', row }) !== 'manager') return;
    void setStatus(row, STATUS_PENDING, {
      planWeekId: row.id,
      achievementId: row.achievementId || data?.defaultAchievementId,
      type: MSG_CONFIRMATION_REQUEST,
      body: `Keeping the current plan — please re-confirm Week ${row.weekNumber}: ${mixSummary(row.mix)}.`,
    }, 'manager');
  }

  async function onToggleReviewed(row: ActivityRow, reviewed: boolean) {
    if (roleFor({ kind: 'activity', row }) !== 'manager') return;
    const prev = { reviewed: row.reviewed, reviewedOn: row.reviewedOn, reviewedByName: row.reviewedByName };
    patchActivity(row.id, { reviewed, reviewedOn: reviewed ? new Date().toISOString() : '', reviewedByName: reviewed ? user?.name || '' : '' });
    try {
      const on = await updateReviewed(row.id, reviewed, actor);
      if (reviewed) patchActivity(row.id, { reviewedOn: on });
    } catch (e) {
      patchActivity(row.id, prev);
      showToast(e instanceof Error ? e.message : 'Could not update the review.');
      return;
    }
    const who = user?.name || 'Manager';
    await postMessage({
      threadType: THREAD_FEEDBACK,
      activityId: row.id,
      achievementId: row.achievementId || data?.defaultAchievementId,
      type: MSG_SYSTEM_EVENT,
      body: reviewed ? `${who} marked this activity as reviewed` : `${who} cleared the review`,
    }, 'manager');
  }

  const isDev = import.meta.env.DEV;

  return (
    <div className="acc-wrap ac-page">
      <div className="acc-head">
        <div>
          <h1 className="acc-title">Activity Communication</h1>
          <div className="acc-sub">Agree weekly objectives with each agent, then review and discuss every logged activity</div>
        </div>
        <div className="acc-actions">
          {role === 'manager' && (
            <AgentPicker
              options={agentOptions}
              value={activeAgentFilter}
              onChange={(id) => {
                setAgentFilter(id);
                setSelected(null);
              }}
            />
          )}
          <MonthPicker
            year={ym.year}
            month={ym.month}
            onChange={(y, m) => {
              setYm({ year: y, month: m });
              setSelected(null);
            }}
          />
          {isDev && (
            <div className="ac-viewas">
              <span>Viewing as</span>
              <div className="ac-seg" role="group" aria-label="Viewing as">
                {(['manager', 'agent'] as const).map((r) => (
                  <button key={r} type="button" className={role === r ? 'on' : ''} onClick={() => setDevRole(r === user?.role ? null : r)}>
                    {r === 'manager' ? 'Manager' : 'Agent'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ac-toolbar">
        <div className="ac-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} onClick={() => { setTab('plan'); setSelected(null); }}>
            <Icon className="fa-solid fa-bullseye" /> Objective planning
            {actions.planCount > 0 && <span className="ac-tab-badge" title="Waiting on you">{actions.planCount}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'feedback'} className={tab === 'feedback' ? 'on' : ''} onClick={() => { setTab('feedback'); setSelected(null); }}>
            <Icon className="fa-solid fa-circle-check" /> After-activity feedback
            {actions.feedbackCount > 0 && <span className="ac-tab-badge" title="Waiting on you">{actions.feedbackCount}</span>}
          </button>
        </div>
      </div>

      {tab === 'plan' ? (
        <div className="kpi-grid">
          <Kpi tone="gold" icon="fa-bullseye" label="Planned visits" value={planStats.planned} loading={loading} context={`across ${planStats.owners.size} agent${planStats.owners.size === 1 ? '' : 's'}`} />
          <Kpi tone="warn" icon="fa-hourglass-half" label="Awaiting confirmation" value={planStats.pending} loading={loading} context="weeks not yet confirmed" />
          <Kpi tone="ok" icon="fa-circle-check" label="Confirmed" value={planStats.confirmed} loading={loading} context="weeks agreed" />
          <Kpi tone="info" icon="fa-comment" label="Change requests" value={planStats.change} loading={loading} context="agent suggested a new mix" />
        </div>
      ) : (
        <div className="kpi-grid">
          <Kpi tone="gold" icon="fa-clipboard-check" label="Logged activities" value={feedbackStats.logged} loading={loading} context={monthLabel} />
          <Kpi tone="warn" icon="fa-hourglass-half" label="Not reviewed" value={feedbackStats.notReviewed} loading={loading} context="waiting on the manager" />
          <Kpi tone="ok" icon="fa-circle-check" label="Reviewed" value={feedbackStats.reviewed} loading={loading} context={feedbackStats.logged ? `${Math.round((feedbackStats.reviewed / feedbackStats.logged) * 100)}% of activities` : '—'} />
          <Kpi tone="info" icon="fa-comment" label="Unread messages" value={feedbackStats.unread} loading={loading} context="in activity threads" />
        </div>
      )}

      {!loading && !ctx.loading && !ctx.error && !loadError && (
        <ActionStrip
          items={actions.items}
          toReview={actions.toReview.length}
          otherMonths={(monthBadges || []).filter((m) => m.count > 0 && !(m.year === ym.year && m.month === ym.month))}
          onOpen={openAction}
          onReview={() => {
            setTab('feedback');
            setSelected(null);
          }}
          onMonth={(year, month) => {
            setYm({ year, month });
            setSelected(null);
          }}
        />
      )}

      {ctx.error || loadError ? (
        <div className="ac-state ac-state-err">
          <Icon className="fa-solid fa-circle-exclamation" /> {ctx.error || loadError}
        </div>
      ) : (
        <div className={`ac-split${target ? ' with-panel' : ''}`}>
          <div className="tbl-shell ac-table-card">
            <div className="tbl-hdr ac-card-hdr">
              <h3>{tab === 'plan' ? 'Weekly objectives' : 'Logged activities'}</h3>
              <span className="dm-count">
                <Icon className="fa-solid fa-users" /> {(tab === 'plan' ? planGroups : activityGroups).length} agent{(tab === 'plan' ? planGroups : activityGroups).length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="ac-tablewrap">
              {loading || ctx.loading ? (
                <div className="acc-state">
                  <Icon className="fa-solid fa-spinner fa-spin" />
                  Loading {monthLabel}…
                </div>
              ) : tab === 'plan' ? (
                plans.length === 0 ? (
                  <div className="acc-state">
                    <Icon className="fa-solid fa-inbox" />
                    No plan weeks for {monthLabel}.
                  </div>
                ) : (
                  <table className="ac-table">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th className="num">Planned</th>
                        {OBJECTIVES.map((o) => (
                          <th key={o.value} className="num">
                            {o.value === 4 ? 'Reconciliation' : o.value === 2 ? 'Dispute res.' : o.label}
                          </th>
                        ))}
                        <th>Status</th>
                        <th>Thread</th>
                      </tr>
                    </thead>
                    {planGroups.map((g) => {
                      const isCollapsed = !isOwnerOpen(g.key);
                      return (
                        <tbody key={g.key} className="ac-group">
                          <tr className="ac-group-row" onClick={() => toggleOwner(g.key)} tabIndex={0} aria-expanded={!isCollapsed} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOwner(g.key); } }}>
                            <td colSpan={8}>
                              <div className="ac-group-head">
                                <Icon className={`fa-solid fa-chevron-down ac-caret${isCollapsed ? ' closed' : ''}`} />
                                <span className="ac-avatar">{initials(g.name)}</span>
                                <span className="ac-group-name">
                                  <b>{g.name}</b>
                                  <small>
                                    {g.weeks.length} week{g.weeks.length === 1 ? '' : 's'} · <span className="ac-mono">{g.planned}</span> planned
                                  </small>
                                </span>
                                <span className="ac-group-stats">
                                  {g.pending > 0 && <span className="ac-pill ac-pill-warn">{g.pending} awaiting</span>}
                                  {g.change > 0 && <span className="ac-pill ac-pill-info">{g.change} change requested</span>}
                                  {g.confirmed > 0 && <span className="ac-pill ac-pill-ok">{g.confirmed} confirmed</span>}
                                  {g.unread > 0 && <span className="ac-unread-inline">{g.unread} unread</span>}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {!isCollapsed &&
                            g.weeks.map((p) => {
                              const sel = selected?.kind === 'plan' && selected.id === p.id;
                              const unread = unreadPlan(p);
                              const count = (messagesByThread.get(`plan:${p.id}`) || []).length;
                              return (
                                <tr key={p.id} className={`ac-week-row${sel ? ' sel' : ''}`} onClick={() => openThread({ kind: 'plan', row: p })} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread({ kind: 'plan', row: p }); } }}>
                                  <td>
                                    <b>Week {p.weekNumber}</b>
                                    <small className="ac-block">{fmtDateRange(p.from, p.to)}</small>
                                  </td>
                                  <td className="num ac-mono ac-strong">{p.plan}</td>
                                  {OBJECTIVES.map((o) => (
                                    <td key={o.value} className="num">
                                      <span className={`ac-count${p.mix[o.value] > 0 ? ' on' : ''}`}>{p.mix[o.value]}</span>
                                    </td>
                                  ))}
                                  <td>
                                    <StatusPill status={p.status} />
                                  </td>
                                  <td>
                                    <ThreadButton count={count} unread={unread} />
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      );
                    })}
                  </table>
                )
              ) : activities.length === 0 ? (
                <div className="acc-state">
                  <Icon className="fa-solid fa-inbox" />
                  No logged activities for {monthLabel}.
                </div>
              ) : (
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Objective</th>
                      <th>Outcome</th>
                      <th>Reviewed</th>
                      <th>Thread</th>
                    </tr>
                  </thead>
                  {activityGroups.map((g) => {
                    const isCollapsed = !isOwnerOpen(g.key);
                    return (
                      <tbody key={g.key} className="ac-group">
                        <tr className="ac-group-row" onClick={() => toggleOwner(g.key)} tabIndex={0} aria-expanded={!isCollapsed} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOwner(g.key); } }}>
                          <td colSpan={5}>
                            <div className="ac-group-head">
                              <Icon className={`fa-solid fa-chevron-down ac-caret${isCollapsed ? ' closed' : ''}`} />
                              <span className="ac-avatar">{initials(g.name)}</span>
                              <span className="ac-group-name">
                                <b>{g.name}</b>
                                <small>
                                  <span className="ac-mono">{g.rows.length}</span> activit{g.rows.length === 1 ? 'y' : 'ies'}
                                </small>
                              </span>
                              <span className="ac-group-stats">
                                {g.notReviewed > 0 && <span className="ac-pill ac-pill-warn">{g.notReviewed} not reviewed</span>}
                                {g.reviewed > 0 && <span className="ac-pill ac-pill-ok">{g.reviewed} reviewed</span>}
                                {g.unread > 0 && <span className="ac-unread-inline">{g.unread} unread</span>}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed &&
                          g.rows.map((a) => {
                            const sel = selected?.kind === 'activity' && selected.id === a.id;
                            const unread = unreadActivity(a);
                            const count = (messagesByThread.get(`activity:${a.id}`) || []).length;
                            return (
                              <tr key={a.id} className={`ac-week-row${sel ? ' sel' : ''}`} onClick={() => openThread({ kind: 'activity', row: a })} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread({ kind: 'activity', row: a }); } }}>
                                <td>
                                  <b>{a.accountName}</b>
                                  <small className="ac-block">
                                    {fmtShortDate(a.date)}
                                    {a.agentName.includes(' & ') ? ` · ${a.agentName}` : ''}
                                  </small>
                                </td>
                                <td>{a.objectiveLabel || <span className="ac-muted">—</span>}</td>
                                <td>
                                  <OutcomePill label={a.outcomeLabel} />
                                </td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    className="ac-check"
                                    checked={a.reviewed}
                                    disabled={roleFor({ kind: 'activity', row: a }) !== 'manager'}
                                    title={roleFor({ kind: 'activity', row: a }) === 'manager' ? 'Reviewed by manager' : isOwnActivity(a) ? "You can't review your own activity" : 'Only the manager can mark as reviewed'}
                                    onChange={(e) => {
                                      pinOwner(activityGroupKey(a), true);
                                      void onToggleReviewed(a, e.target.checked);
                                    }}
                                  />
                                </td>
                                <td>
                                  <ThreadButton count={count} unread={unread} />
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    );
                  })}
                </table>
              )}
            </div>
          </div>

          {target && user && (
            <ThreadPanel
              key={threadKey}
              target={target}
              messages={threadMessages}
              role={roleFor(target)}
              myIds={myIds}
              monthLabel={monthLabel}
              onSend={onSend}
              onToggleConfirm={onToggleConfirm}
              onRecommend={onRecommend}
              onAskReconfirm={onAskReconfirm}
              onEditObjectives={() => onNavigate?.('visit-plan')}
              onToggleReviewed={(row, v) => void onToggleReviewed(row, v)}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      <div className={`acc-toast${toast ? ' on' : ''}`} role="status">
        {toast}
      </div>
    </div>
  );
}

/** Same shared KPI card as every other page (shared.css .kpi-card). */
function Kpi({ tone, icon, label, value, context, loading }: { tone: 'gold' | 'warn' | 'ok' | 'info'; icon: string; label: string; value: number; context: string; loading: boolean }) {
  return (
    <div className={`kpi-card${tone === 'gold' ? '' : ` kpi-${tone}`}`}>
      <div className="kpi-top">
        <span className={`kpi-icon kpi-icon-${tone}`}>
          <Icon className={`fa-solid ${icon}`} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{loading ? '—' : value.toLocaleString('en-US')}</div>
      <div className="kpi-context">{loading ? ' ' : context}</div>
    </div>
  );
}

function ThreadButton({ count, unread }: { count: number; unread: number }) {
  return (
    <span className={`ac-thread-btn${unread ? ' unread' : ''}`} title={unread ? `${unread} unread` : 'Open thread'}>
      <Icon className="fa-solid fa-comment" />
      <span className="ac-mono">{count}</span>
      {unread > 0 && <span className="ac-unread">{unread}</span>}
    </span>
  );
}

const STRIP_LIMIT = 4;

/**
 * "Waiting on you" — one quiet card above the table listing only what the
 * signed-in user has to act on, each with the other party's name, one click
 * from its thread. Renders nothing when there's nothing to do.
 */
function ActionStrip({
  items,
  toReview,
  otherMonths,
  onOpen,
  onReview,
  onMonth,
}: {
  items: ActionItem[];
  toReview: number;
  otherMonths: MonthBadge[];
  onOpen: (item: ActionItem) => void;
  onReview: () => void;
  onMonth: (year: number, month: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!items.length && !toReview && !otherMonths.length) return null;
  const shown = showAll ? items : items.slice(0, STRIP_LIMIT);

  return (
    <div className="tbl-shell ac-actions">
      <div className="tbl-hdr">
        <h3 className="ac-actions-title">
          <Icon className="fa-solid fa-list-check" /> Waiting on you
        </h3>
        {items.length > 0 && <span className="dm-count">{items.length} item{items.length === 1 ? '' : 's'}</span>}
      </div>
      {shown.map((it) => {
        const t = it.target;
        const where = t.kind === 'plan' ? `Week ${t.row.weekNumber} · ${fmtDateRange(t.row.from, t.row.to)}` : `${t.row.accountName} · ${fmtShortDate(t.row.date)}`;
        const [text, cta] =
          it.type === 'change-request'
            ? [<><b>{it.who}</b> asked to change the objectives</>, 'Review']
            : it.type === 'confirm'
              ? [<>Confirm your objectives</>, 'Confirm']
              : [<><b>{it.who}</b> sent {it.unread} new message{it.unread === 1 ? '' : 's'}</>, 'Open'];
        return (
          <button key={it.key} type="button" className={`ac-action ac-action-${it.type}`} onClick={() => onOpen(it)}>
            <span className="ac-avatar ac-avatar-sm">{initials(it.who)}</span>
            <span className="ac-action-text">
              <span>{text}</span>
              <small>{where}</small>
            </span>
            <span className="ac-action-cta">
              {cta} <Icon className="fa-solid fa-chevron-right" />
            </span>
          </button>
        );
      })}
      {(items.length > STRIP_LIMIT || toReview > 0 || otherMonths.length > 0) && (
        <div className="ac-action-foot">
          {items.length > STRIP_LIMIT && (
            <button type="button" className="ac-link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show less' : `Show ${items.length - STRIP_LIMIT} more`}
            </button>
          )}
          {toReview > 0 && (
            <button type="button" className="ac-link" onClick={onReview}>
              {toReview} activit{toReview === 1 ? 'y' : 'ies'} to review
            </button>
          )}
          {otherMonths.map((m) => (
            <button key={`${m.year}-${m.month}`} type="button" className="ac-link" onClick={() => onMonth(m.year, m.month)}>
              {m.count} waiting in {MONTHS[m.month - 1]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
