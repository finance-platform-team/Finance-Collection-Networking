import {
  MSG_SYSTEM_EVENT,
  ROLE_AGENT,
  ROLE_MANAGER,
  STATUS_CHANGE_REQUESTED,
  STATUS_CONFIRMED,
  THREAD_PLANNING,
  type ActivityRow,
  type AgentRef,
  type Message,
  type MonthData,
  type PlanRow,
} from './activityComm';
import type { CurrentUser, UserRole } from './useCurrentUser';
import type { Region } from './useRegion';

/**
 * "Needs your action" for Activity Communication — shared by the page (its
 * action strip, tab badges, group ordering) and the sidebar badge, so both
 * always agree. Only counts what is waiting on *this* user:
 *  - Manager: change requests an agent sent on their week plan, activities not
 *    yet reviewed, and unread messages from the agent;
 *  - Agent: weeks waiting for their confirmation and unread messages.
 * The sidebar badge leaves out the not-reviewed backlog (it can be large and
 * nobody is blocked on it) so the badge only lights up when someone is waiting.
 */

export type ThreadRef = { kind: 'plan'; row: PlanRow } | { kind: 'activity'; row: ActivityRow };

export interface ActionItem {
  key: string;
  type: 'change-request' | 'confirm' | 'unread';
  target: ThreadRef;
  /** The other party — the agent who asked, or whoever sent the unread messages. */
  who: string;
  unread: number;
}

export interface ActionSummary {
  /** Change requests / confirmations / unread threads, most urgent first. */
  items: ActionItem[];
  /** Manager only: others' activities still waiting for a review. */
  toReview: ActivityRow[];
  planCount: number;
  feedbackCount: number;
  /** Sidebar badge: everything except the review backlog. */
  badge: number;
  /** Group keys (as the page groups rows) that hold at least one action. */
  groupKeys: Set<string>;
}

export const planGroupKey = (p: PlanRow) => p.employeeId || p.ownerName;
export const activityGroupKey = (a: ActivityRow) => `act:${a.agentIds[0] || a.agentName}`;
export const threadKeyOf = (t: ThreadRef) => `${t.kind}:${t.row.id}`;

export function myIdsOf(user: CurrentUser | null): string[] {
  return [user?.systemUserId, user?.employeeId, ...(user?.agentIds || [])].filter((x): x is string => !!x);
}

export function isOwnPlan(user: CurrentUser | null, p: PlanRow): boolean {
  return !!user && !!p.employeeId && user.myEmployeeIds.has(p.employeeId);
}

export function isOwnActivity(user: CurrentUser | null, a: ActivityRow): boolean {
  return !!user && (a.agentIds.some((id) => user.agentIds.includes(id)) || a.employeeIds.some((id) => user.myEmployeeIds.has(id)));
}

/** A user can be an agent and a manager at once: on their own rows they act as
 *  the Agent (confirm / recommend, no self-review), on everyone else's as the Manager. */
export function roleOn(user: CurrentUser | null, t: ThreadRef): UserRole {
  if (!user) return 'agent';
  const own = t.kind === 'plan' ? isOwnPlan(user, t.row) : isOwnActivity(user, t.row);
  if (own && user.isAgent) return 'agent';
  return user.role;
}

/** Sent by the signed-in user — by sender id when the lookup is set, else by
 *  the role they hold on that thread. */
export function isFromMe(m: Message, myIds: string[], threadRole: UserRole): boolean {
  if (m.senderId) return myIds.some((id) => id.toLowerCase() === m.senderId.toLowerCase());
  return m.senderRole === (threadRole === 'agent' ? ROLE_AGENT : ROLE_MANAGER);
}

export function groupMessages(messages: Message[]): Map<string, Message[]> {
  const map = new Map<string, Message[]>();
  messages.forEach((m) => {
    const key = m.threadType === THREAD_PLANNING ? `plan:${m.planWeekId}` : `activity:${m.activityId}`;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  });
  return map;
}

export function unreadFor(thread: Message[], myIds: string[], role: UserRole): Message[] {
  return thread.filter((m) => !m.isRead && !m.pending && m.type !== MSG_SYSTEM_EVENT && !isFromMe(m, myIds, role));
}

/** Rows this user may see: an agent their own, a manager their team, then the
 *  app-wide Region (a row's region is its agent's cr18c_area). `unrestricted`
 *  skips the team scope (the dev-only "viewing as" toggle). */
export function scopeMonth(
  data: MonthData | null,
  user: CurrentUser | null,
  agents: AgentRef[],
  region: Region | null,
  unrestricted = false
): { plans: PlanRow[]; activities: ActivityRow[] } {
  if (!data || !user) return { plans: [], activities: [] };
  let allowEmployee: (id: string) => boolean = () => true;
  let allowActivity: (a: ActivityRow) => boolean = () => true;
  if (!unrestricted) {
    if (user.role === 'agent') {
      const mine = new Set(user.agentIds);
      const myEmployees = user.visibleEmployeeIds || new Set<string>();
      allowEmployee = (id) => !!id && myEmployees.has(id);
      allowActivity = (a) => a.agentIds.some((id) => mine.has(id)) || a.employeeIds.some((id) => myEmployees.has(id));
    } else if (user.visibleEmployeeIds) {
      const team = user.visibleEmployeeIds;
      allowEmployee = (id) => team.has(id);
      allowActivity = (a) => a.employeeIds.some((id) => team.has(id));
    } else if (user.managerRegion) {
      // Managers review each other, but only within their own region — other
      // regions' managers stay hidden even when the Region switch shows them.
      const myRegion = user.managerRegion;
      const otherManagerEmployees = new Set(agents.filter((a) => a.isManager && a.region !== myRegion && a.employeeId).map((a) => a.employeeId));
      const otherManagerAgents = new Set(agents.filter((a) => a.isManager && a.region !== myRegion).map((a) => a.id));
      allowEmployee = (id) => !otherManagerEmployees.has(id);
      allowActivity = (a) =>
        a.agentIds[0] ? !otherManagerAgents.has(a.agentIds[0]) : !otherManagerEmployees.has(a.employeeIds[0] || '');
    }
  }
  const regionByEmployee = new Map(agents.filter((a) => a.employeeId).map((a) => [a.employeeId, a.region]));
  const regionByAgent = new Map(agents.map((a) => [a.id, a.region]));
  const inRegion = (r: 'EG' | 'KSA' | undefined) => !region || (r || 'EG') === region;
  return {
    plans: data.plans.filter((p) => allowEmployee(p.employeeId) && inRegion(regionByEmployee.get(p.employeeId))),
    activities: data.activities.filter(
      (a) => allowActivity(a) && inRegion(regionByAgent.get(a.agentIds[0] || '') ?? regionByEmployee.get(a.employeeIds[0] || ''))
    ),
  };
}

export function computeActions(
  rows: { plans: PlanRow[]; activities: ActivityRow[] },
  messagesByThread: Map<string, Message[]>,
  myIds: string[],
  roleFor: (t: ThreadRef) => UserRole
): ActionSummary {
  const items: ActionItem[] = [];
  const toReview: ActivityRow[] = [];
  const groupKeys = new Set<string>();
  let planCount = 0;
  let feedbackCount = 0;

  const senderOf = (msgs: Message[], fallback: string) => msgs[msgs.length - 1]?.senderName || fallback;

  rows.plans.forEach((p) => {
    const target: ThreadRef = { kind: 'plan', row: p };
    const role = roleFor(target);
    const unread = unreadFor(messagesByThread.get(threadKeyOf(target)) || [], myIds, role);
    let type: ActionItem['type'] | null = null;
    if (role === 'manager' && p.status === STATUS_CHANGE_REQUESTED) type = 'change-request';
    else if (role === 'agent' && p.status !== STATUS_CONFIRMED && p.status !== STATUS_CHANGE_REQUESTED) type = 'confirm';
    else if (unread.length) type = 'unread';
    if (!type) return;
    items.push({ key: threadKeyOf(target), type, target, who: type === 'unread' ? senderOf(unread, p.ownerName) : p.ownerName, unread: unread.length });
    groupKeys.add(planGroupKey(p));
    planCount++;
  });

  rows.activities.forEach((a) => {
    const target: ThreadRef = { kind: 'activity', row: a };
    const role = roleFor(target);
    const unread = unreadFor(messagesByThread.get(threadKeyOf(target)) || [], myIds, role);
    const needsReview = role === 'manager' && !a.reviewed;
    if (needsReview) toReview.push(a);
    if (unread.length) items.push({ key: threadKeyOf(target), type: 'unread', target, who: senderOf(unread, a.agentName), unread: unread.length });
    if (needsReview || unread.length) {
      groupKeys.add(activityGroupKey(a));
      feedbackCount++;
    }
  });

  const rank = { 'change-request': 0, confirm: 1, unread: 2 } as const;
  items.sort((x, y) => rank[x.type] - rank[y.type]);
  return { items, toReview, planCount, feedbackCount, badge: items.length, groupKeys };
}
