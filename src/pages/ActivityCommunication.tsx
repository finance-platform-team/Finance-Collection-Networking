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
import type { PageKey } from '../components/Layout';
import type { Region } from '../lib/useRegion';
import './ActivityCommunication.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Tab = 'plan' | 'feedback';

interface ActivityCommunicationPageProps {
  region: Region | null;
  onNavigate?: (page: PageKey) => void;
}


export default function ActivityCommunicationPage({ region, onNavigate }: ActivityCommunicationPageProps) {
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
  const myIds = useMemo(() => [user?.systemUserId, user?.employeeId, ...(user?.agentIds || [])].filter((x): x is string => !!x), [user]);

  const isOwnPlan = useCallback((p: PlanRow) => !!user && !!p.employeeId && user.myEmployeeIds.has(p.employeeId), [user]);
  const isOwnActivity = useCallback(
    (a: ActivityRow) => !!user && (a.agentIds.some((id) => user.agentIds.includes(id)) || a.employeeIds.some((id) => user.myEmployeeIds.has(id))),
    [user]
  );
  const roleFor = useCallback(
    (t: ThreadTarget): UserRole => {
      if (devRole) return devRole;
      if (!user) return 'agent';
      const own = t.kind === 'plan' ? isOwnPlan(t.row) : isOwnActivity(t.row);
      if (own && user.isAgent) return 'agent';
      return user.role;
    },
    [devRole, user, isOwnPlan, isOwnActivity]
  );
  const senderRoleOf = (r: UserRole) => (r === 'agent' ? ROLE_AGENT : ROLE_MANAGER);
  /** Sent by the signed-in user — by sender id when the lookup is set, else by
   *  the role they hold on that thread. */
  const isFromMe = useCallback(
    (m: Message, threadRole: UserRole) => (m.senderId ? myIds.some((id) => id.toLowerCase() === m.senderId.toLowerCase()) : m.senderRole === senderRoleOf(threadRole)),
    [myIds]
  );

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

  // ---- scope: an agent sees only their own rows, a manager their team. The
  // dev-only role toggle doesn't narrow scope, so either side can be tested.
  const visible = useMemo(() => {
    if (!data || !user) return { plans: [] as PlanRow[], activities: [] as ActivityRow[] };
    let allowEmployee: (id: string) => boolean = () => true;
    let allowActivity: (a: ActivityRow) => boolean = () => true;
    if (!devRole) {
      if (user.role === 'agent') {
        const mine = new Set(user.agentIds);
        const myEmployees = user.visibleEmployeeIds || new Set<string>();
        allowEmployee = (id) => !!id && myEmployees.has(id);
        allowActivity = (a) => a.agentIds.some((id) => mine.has(id)) || a.employeeIds.some((id) => myEmployees.has(id));
      } else if (user.visibleEmployeeIds) {
        const team = user.visibleEmployeeIds;
        allowEmployee = (id) => team.has(id);
        allowActivity = (a) => a.employeeIds.some((id) => team.has(id));
      }
    }
    // App-wide Region (sidebar): a row's region is its agent's cr18c_area —
    // by employee for plan weeks, by Task Owner 1 for activities. No region
    // chosen = everything.
    const regionByEmployee = new Map(ctx.agents.filter((a) => a.employeeId).map((a) => [a.employeeId, a.region]));
    const regionByAgent = new Map(ctx.agents.map((a) => [a.id, a.region]));
    const inRegion = (r: 'EG' | 'KSA' | undefined) => !region || (r || 'EG') === region;
    return {
      plans: data.plans.filter((p) => allowEmployee(p.employeeId) && inRegion(regionByEmployee.get(p.employeeId))),
      activities: data.activities.filter(
        (a) => allowActivity(a) && inRegion(regionByAgent.get(a.agentIds[0] || '') ?? regionByEmployee.get(a.employeeIds[0] || ''))
      ),
    };
  }, [data, user, devRole, region, ctx.agents]);

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

  const messagesByThread = useMemo(() => {
    const map = new Map<string, Message[]>();
    (data?.messages || []).forEach((m) => {
      const key = m.threadType === THREAD_PLANNING ? `plan:${m.planWeekId}` : `activity:${m.activityId}`;
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    });
    return map;
  }, [data?.messages]);
  const unreadIn = useCallback(
    (t: ThreadTarget) => {
      const r = roleFor(t);
      return (messagesByThread.get(`${t.kind}:${t.row.id}`) || []).filter((m) => !m.isRead && !m.pending && m.type !== MSG_SYSTEM_EVENT && !isFromMe(m, r));
    },
    [messagesByThread, roleFor, isFromMe]
  );
  const unreadPlan = useCallback((p: PlanRow) => unreadIn({ kind: 'plan', row: p }).length, [unreadIn]);
  const unreadActivity = useCallback((a: ActivityRow) => unreadIn({ kind: 'activity', row: a }).length, [unreadIn]);

  // One group per task owner (by employee), weeks in week order underneath.
  const planGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; weeks: PlanRow[]; planned: number; pending: number; confirmed: number; change: number; unread: number }>();
    plans.forEach((p) => {
      const key = p.employeeId || p.ownerName;
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
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }, [plans, unreadPlan]);
  // Activities grouped by their primary task owner (double visits list under
  // Task Owner 1 and show both names on the row), newest first within a group.
  const activityGroups = useMemo(() => {
    const nameByAgent = new Map(ctx.agents.map((a) => [a.id, a.name]));
    const map = new Map<string, { key: string; name: string; rows: ActivityRow[]; reviewed: number; notReviewed: number; unread: number }>();
    activities.forEach((a) => {
      const primary = a.agentIds[0] || '';
      const key = `act:${primary || a.agentName}`;
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
    return groups.sort((x, y) => x.name.localeCompare(y.name));
  }, [activities, ctx.agents, unreadActivity]);
  // Groups start collapsed; a key lands here once the user expands it.
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());
  function toggleOwner(key: string) {
    setExpandedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
    const unread = unreadIn(t).map((m) => m.id);
    if (!unread.length) return;
    const ids = new Set(unread);
    patchMessages((list) => list.map((m) => (ids.has(m.id) ? { ...m, isRead: true } : m)));
    markRead(unread).catch((e) => {
      patchMessages((list) => list.map((m) => (ids.has(m.id) ? { ...m, isRead: false } : m)));
      showToast(e instanceof Error ? e.message : 'Could not mark messages as read.');
    });
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

  const planBadge = planStats.pending + planStats.change;
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
            {planBadge > 0 && <span className="ac-tab-badge">{planBadge}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'feedback'} className={tab === 'feedback' ? 'on' : ''} onClick={() => { setTab('feedback'); setSelected(null); }}>
            <Icon className="fa-solid fa-circle-check" /> After-activity feedback
            {feedbackStats.notReviewed > 0 && <span className="ac-tab-badge">{feedbackStats.notReviewed}</span>}
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
                      const isCollapsed = !expandedOwners.has(g.key);
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
                                  {g.change > 0 && <span className="ac-pill ac-pill-info">{g.change} change</span>}
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
                    const isCollapsed = !expandedOwners.has(g.key);
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
                                    onChange={(e) => void onToggleReviewed(a, e.target.checked)}
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
