import { getClient } from '@microsoft/power-apps/data';
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo';
import { Pm_kpiachievmentsService } from '../generated/services/Pm_kpiachievmentsService';
import { Stf_kpiachievmentbreakdownsService } from '../generated/services/Stf_kpiachievmentbreakdownsService';
import { Cfm_collectionplanweeksService } from '../generated/services/Cfm_collectionplanweeksService';
import { Cfm_planweekobjectivesService } from '../generated/services/Cfm_planweekobjectivesService';
import { Cfm_activitymessagesService } from '../generated/services/Cfm_activitymessagesService';
import { Cr301_visitsService } from '../generated/services/Cr301_visitsService';
import { Strategy_kpisesService } from '../generated/services/Strategy_kpisesService';
import type { Cfm_activitymessagesBase } from '../generated/models/Cfm_activitymessagesModel';
import type { Cfm_collectionplanweeksBase } from '../generated/models/Cfm_collectionplanweeksModel';
import type { Cr301_visitsBase } from '../generated/models/Cr301_visitsModel';
import { fetchAll } from './dataverse';
import { operationErrorMessage } from './errors';
import { OBJECTIVE_OPTIONS, OUTCOME_OPTIONS, optionLabels, parseMultiChoice } from './activityOptions';

/**
 * Data layer for the Activity Communication page (manager ↔ collection agent
 * threads). Everything for one month loads in a handful of batched queries and
 * is joined locally by id — no $expand, no per-row calls.
 *
 * Month scoping follows the same chain VisitPlan.tsx uses: the "No. of Visits"
 * KPI → that month's pm_kpiachievments → their stf_kpiachievmentbreakdowns
 * (one per task owner) → cfm_collectionplanweeks → cfm_planweekobjectives.
 * Plan weeks are only ever bound to their breakdown (not to cfm_KPIAchievement)
 * by VisitPlan's wizard, so the breakdown is the reliable join here.
 */

// ---- choice values (generated models) ----
export const STATUS_PENDING = 766340000;
export const STATUS_CONFIRMED = 766340001;
export const STATUS_CHANGE_REQUESTED = 766340003;
export type ConfirmationStatus = typeof STATUS_PENDING | typeof STATUS_CONFIRMED | typeof STATUS_CHANGE_REQUESTED;

export const THREAD_PLANNING = 766340000;
export const THREAD_FEEDBACK = 766340001;
export type ThreadType = typeof THREAD_PLANNING | typeof THREAD_FEEDBACK;

export const ROLE_AGENT = 766340000;
export const ROLE_MANAGER = 766340001;
export type SenderRole = typeof ROLE_AGENT | typeof ROLE_MANAGER;

export const MSG_COMMENT = 766340000;
export const MSG_CONFIRMATION_REQUEST = 766340001;
export const MSG_CHANGE_RECOMMENDATION = 766340002;
/**
 * cfm_messagetype has no "System Event" option in Dataverse yet — only
 * Comment / Confirmation Request / Change Recommendation / Confirmation. State
 * changes (confirm, un-confirm, reviewed) are written as "Confirmation" and
 * rendered as the centered system pill. Once a real System Event option is
 * added, point this at its value.
 */
export const MSG_SYSTEM_EVENT = 766340003;
export type MessageType = typeof MSG_COMMENT | typeof MSG_CONFIRMATION_REQUEST | typeof MSG_CHANGE_RECOMMENDATION | typeof MSG_SYSTEM_EVENT;

const DEFAULT_KPI_NAME = 'No. of Visits';
const DEFAULT_KPI_FUNCTION = 'Collection/Finance';
const DEFAULT_KPI_DEPARTMENT = 'Finance';
// Same cfm_tagename / status scoping Visits.tsx and VisitPlan.tsx use.
const TAG_COLLECTION = 766340000;
const VISIT_STATUS_CANCELLED = 983080002;

const WEEKS_TABLE = 'cfm_collectionplanweeks';
const VISITS_TABLE = 'cr301_visits';

// Fixed calendar-day buckets — must match VisitPlan.tsx's MONTH_WEEK_BOUNDS.
const MONTH_WEEK_BOUNDS: [number, number][] = [
  [1, 10],
  [11, 18],
  [19, 25],
  [26, 31],
];

export const OBJECTIVES = OBJECTIVE_OPTIONS;
export type ObjectiveMix = Record<1 | 2 | 3 | 4, number>;
export const EMPTY_MIX: ObjectiveMix = { 1: 0, 2: 0, 3: 0, 4: 0 };

// ---- view models ----
export interface PlanRow {
  id: string;
  weekNumber: number;
  from: string;
  to: string;
  plan: number;
  mix: ObjectiveMix;
  status: ConfirmationStatus;
  agentConfirmed: boolean;
  confirmedOn: string;
  confirmedByName: string;
  employeeId: string;
  ownerName: string;
  achievementId: string;
}

export interface ActivityRow {
  id: string;
  date: string;
  accountName: string;
  agentIds: string[];
  employeeIds: string[];
  agentName: string;
  /** cr18c_objective / cr18c_outcome are multi-select. */
  objectives: number[];
  objectiveLabel: string;
  outcomes: number[];
  outcomeLabels: string[];
  reviewed: boolean;
  reviewedOn: string;
  reviewedByName: string;
  achievementId: string;
}

export interface Message {
  id: string;
  threadType: ThreadType;
  planWeekId: string;
  activityId: string;
  senderId: string;
  senderName: string;
  senderRole: SenderRole;
  type: MessageType;
  body: string;
  suggestedMix: ObjectiveMix | null;
  isRead: boolean;
  createdOn: string;
  /** Optimistic message not yet confirmed by the server. */
  pending?: boolean;
}

export interface MonthData {
  plans: PlanRow[];
  activities: ActivityRow[];
  messages: Message[];
  /** Month's achievement id per task owner (hr_employee id), for stamping
   *  cfm_kpiachievement on feedback messages. */
  achievementByEmployee: Map<string, string>;
  defaultAchievementId: string;
}

export interface AgentRef {
  id: string;
  name: string;
  employeeId: string;
  /** From cr301_agents.cr18c_area — KSA = the KSA choice, everything else
   *  (including unset) is Egypt, same convention as Agents.tsx / VisitPlan.tsx. */
  region: 'EG' | 'KSA';
  /** cfm_ismanager — managers log activities too and are reviewed by their
   *  peer managers in the same region. */
  isManager: boolean;
}

// ---- helpers ----
export function formattedValue(record: unknown, attribute: string): string {
  const raw = (record as Record<string, unknown>)[`${attribute}@OData.Community.Display.V1.FormattedValue`];
  return typeof raw === 'string' ? raw : '';
}
function N(v: unknown): number {
  return Number(v || 0);
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}
export function bucketRange(year: number, month: number, week: number): { from: string; to: string } {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const [a, b] = MONTH_WEEK_BOUNDS[week - 1] || [1, daysInMonth];
  return {
    from: new Date(Date.UTC(year, month - 1, a)).toISOString(),
    to: new Date(Date.UTC(year, month - 1, Math.min(b, daysInMonth))).toISOString(),
  };
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}
export function fmtShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function fmtDateRange(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const m = a.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${m} ${a.getUTCDate()} – ${b.getUTCDate()}`;
}
export function parseMix(raw: string | undefined): ObjectiveMix | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Record<'collection' | 'disputeResolution' | 'followUp' | 'reconciliation', number>>;
    return { 1: N(j.collection), 2: N(j.disputeResolution), 3: N(j.followUp), 4: N(j.reconciliation) };
  } catch {
    return null;
  }
}
export function mixToJson(mix: ObjectiveMix): string {
  return JSON.stringify({ collection: mix[1], disputeResolution: mix[2], followUp: mix[3], reconciliation: mix[4] });
}
export function mixSummary(mix: ObjectiveMix): string {
  return OBJECTIVES.map((o) => `${o.label} ${mix[o.value]}`).join(', ');
}

/** Runs one getAll per chunk of ids (an OR-list of `${field} eq id`) in
 *  parallel — keeps each request's URL well under Dataverse's limit. */
async function fetchByIds<T>(
  ids: string[],
  field: string,
  run: (filter: string, skipToken?: string) => Promise<{ success: boolean; data?: T[] | null; error?: unknown; skipToken?: string }>,
  fallback: string,
  extraFilter = ''
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 40) chunks.push(unique.slice(i, i + 40));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const ors = chunk.map((id) => `${field} eq ${id}`).join(' or ');
      const filter = extraFilter ? `(${ors}) and ${extraFilter}` : `(${ors})`;
      return fetchAll<T>((skipToken) => run(filter, skipToken), fallback);
    })
  );
  return results.flat();
}

/** Same lookup-binding split VisitPlan.tsx's bindLookups uses: plain fields go
 *  through the generated service, @odata.bind keys (schema names) go through
 *  the raw client separately. A null target clears the lookup. */
async function bindLookups(table: string, id: string, binds: Record<string, string | null>): Promise<void> {
  const body: Record<string, unknown> = {};
  for (const [nav, target] of Object.entries(binds)) body[`${nav}@odata.bind`] = target;
  if (!Object.keys(body).length) return;
  const client = getClient(dataSourcesInfo);
  const res = await client.updateRecordAsync(table, id, body);
  if (!res.success) throw new Error(operationErrorMessage(res.error, 'Could not link the record.'));
}

// ---- reads ----
let cachedKpiId: Promise<string> | null = null;
function resolveKpiId(): Promise<string> {
  if (!cachedKpiId) {
    cachedKpiId = (async () => {
      const rows = await fetchAll<{ strategy_kpisid: string; strategy_newcolumn?: string }>(
        (skipToken) =>
          Strategy_kpisesService.getAll({
            select: ['strategy_kpisid', 'strategy_newcolumn', '_strategy_function_value', '_strategy_department_value'],
            filter: `statecode eq 0 and strategy_newcolumn eq '${DEFAULT_KPI_NAME}'`,
            maxPageSize: 5000,
            skipToken,
          }),
        'Could not load KPIs.'
      );
      const kpi = rows.find(
        (k) =>
          formattedValue(k, '_strategy_function_value').trim().toLowerCase() === DEFAULT_KPI_FUNCTION.toLowerCase() &&
          formattedValue(k, '_strategy_department_value').trim().toLowerCase() === DEFAULT_KPI_DEPARTMENT.toLowerCase()
      );
      if (!kpi) throw new Error(`KPI "${DEFAULT_KPI_NAME}" (${DEFAULT_KPI_FUNCTION} / ${DEFAULT_KPI_DEPARTMENT}) not found.`);
      return kpi.strategy_kpisid;
    })();
    cachedKpiId.catch(() => {
      cachedKpiId = null;
    });
  }
  return cachedKpiId;
}

const WEEK_SELECT = [
  'cfm_collectionplanweekid',
  'cfm_weeknumber',
  'cfm_plan',
  'cfm_weekfrom',
  'cfm_weekto',
  'cfm_confirmationstatus',
  'cfm_agentconfirmed',
  'cfm_confirmedon',
  '_cfm_confirmedby_value',
  '_cfm_kpiachievementbreakdown_value',
];
const VISIT_SELECT = [
  'cr301_visitid',
  'cr301_visitdate',
  '_cr301_account_value',
  '_cr301_agent_value',
  '_cfm_agent2_value',
  'cr18c_objective',
  'cr18c_outcome',
  'cfm_reviewed',
  'cfm_reviewedon',
  '_cfm_reviewedby_value',
];
const MESSAGE_SELECT = [
  'cfm_activitymessageid',
  'cfm_threadtype',
  '_cfm_planweek_value',
  '_cfm_activity_value',
  '_cfm_sender_value',
  'cfm_senderrole',
  'cfm_messagetype',
  'cfm_body',
  'cfm_suggestedmix',
  'cfm_isread',
  'createdon',
];

function toMessage(r: Record<string, unknown>): Message {
  return {
    id: String(r.cfm_activitymessageid),
    threadType: (N(r.cfm_threadtype) || THREAD_PLANNING) as ThreadType,
    planWeekId: String(r._cfm_planweek_value || ''),
    activityId: String(r._cfm_activity_value || ''),
    senderId: String(r._cfm_sender_value || ''),
    senderName: formattedValue(r, '_cfm_sender_value'),
    senderRole: (N(r.cfm_senderrole) || ROLE_MANAGER) as SenderRole,
    type: (N(r.cfm_messagetype) || MSG_COMMENT) as MessageType,
    body: String(r.cfm_body || ''),
    suggestedMix: parseMix(r.cfm_suggestedmix as string | undefined),
    isRead: !!r.cfm_isread,
    createdOn: String(r.createdon || ''),
  };
}

export async function loadMonth(year: number, month: number, agents: AgentRef[], employeeNames: Map<string, string>): Promise<MonthData> {
  const kpiId = await resolveKpiId();
  const range = monthRange(year, month);

  // 1) The month's achievements + the month's activities (independent).
  const [achRows, visitRows] = await Promise.all([
    fetchAll<{ pm_kpiachievmentid: string }>(
      (skipToken) =>
        Pm_kpiachievmentsService.getAll({
          select: ['pm_kpiachievmentid'],
          filter: `_pm_kpi_value eq ${kpiId} and pm_month eq ${month} and pm_year eq ${year} and statecode eq 0`,
          maxPageSize: 5000,
          skipToken,
        }),
      'Could not load KPI achievements.'
    ),
    fetchAll<Record<string, unknown>>(
      (skipToken) =>
        Cr301_visitsService.getAll({
          select: VISIT_SELECT,
          filter: `cfm_tagename eq ${TAG_COLLECTION} and cr301_visitstatus ne ${VISIT_STATUS_CANCELLED} and cr301_visitdate ge ${range.from} and cr301_visitdate lt ${range.to}`,
          orderBy: ['cr301_visitdate desc'],
          maxPageSize: 5000,
          skipToken,
        }) as never,
      'Could not load activities.'
    ),
  ]);
  const achIds = achRows.map((a) => a.pm_kpiachievmentid);

  // 2) Breakdowns (task owners) for those achievements, and every message
  //    stamped with one of them (both thread types carry cfm_kpiachievement).
  const [brkRows, messageRows] = await Promise.all([
    fetchByIds<{ stf_kpiachievmentbreakdownid: string; _stf_total_value?: string; _stf_employee_value?: string }>(
      achIds,
      '_stf_total_value',
      (filter, skipToken) =>
        Stf_kpiachievmentbreakdownsService.getAll({
          select: ['stf_kpiachievmentbreakdownid', '_stf_total_value', '_stf_employee_value'],
          filter,
          maxPageSize: 5000,
          skipToken,
        }),
      'Could not load task owners.',
      'statecode eq 0'
    ),
    fetchByIds<Record<string, unknown>>(
      achIds,
      '_cfm_kpiachievement_value',
      (filter, skipToken) =>
        Cfm_activitymessagesService.getAll({ select: MESSAGE_SELECT, filter, orderBy: ['createdon asc'], maxPageSize: 5000, skipToken }) as never,
      'Could not load messages.',
      'statecode eq 0'
    ),
  ]);

  // 3) Weeks for those breakdowns, then their objectives.
  const weekRows = await fetchByIds<Record<string, unknown>>(
    brkRows.map((b) => b.stf_kpiachievmentbreakdownid),
    '_cfm_kpiachievementbreakdown_value',
    (filter, skipToken) =>
      Cfm_collectionplanweeksService.getAll({ select: WEEK_SELECT, filter, orderBy: ['cfm_weeknumber asc'], maxPageSize: 5000, skipToken }) as never,
    'Could not load plan weeks.',
    'statecode eq 0'
  );
  const objectiveRows = await fetchByIds<{ cfm_objective?: number; cfm_target?: number; _cfm_collectionplanweek_value?: string }>(
    weekRows.map((w) => String(w.cfm_collectionplanweekid)),
    '_cfm_collectionplanweek_value',
    (filter, skipToken) =>
      Cfm_planweekobjectivesService.getAll({
        select: ['cfm_objective', 'cfm_target', '_cfm_collectionplanweek_value'],
        filter,
        maxPageSize: 5000,
        skipToken,
      }),
    'Could not load week objectives.',
    'statecode eq 0'
  );

  // ---- join ----
  const brkById = new Map(brkRows.map((b) => [b.stf_kpiachievmentbreakdownid, b]));
  const achievementByEmployee = new Map<string, string>();
  brkRows.forEach((b) => {
    if (b._stf_employee_value && b._stf_total_value) achievementByEmployee.set(b._stf_employee_value, b._stf_total_value);
  });

  const mixByWeek = new Map<string, ObjectiveMix>();
  objectiveRows.forEach((o) => {
    const weekId = o._cfm_collectionplanweek_value;
    const obj = N(o.cfm_objective) as 1 | 2 | 3 | 4;
    if (!weekId || !(obj in EMPTY_MIX)) return;
    const mix = mixByWeek.get(weekId) || { ...EMPTY_MIX };
    mix[obj] += N(o.cfm_target);
    mixByWeek.set(weekId, mix);
  });

  const plans: PlanRow[] = weekRows.map((w) => {
    const id = String(w.cfm_collectionplanweekid);
    const brk = brkById.get(String(w._cfm_kpiachievementbreakdown_value || ''));
    const employeeId = brk?._stf_employee_value || '';
    const weekNumber = N(w.cfm_weeknumber);
    const fallback = bucketRange(year, month, weekNumber);
    const mix = mixByWeek.get(id) || { ...EMPTY_MIX };
    const status = N(w.cfm_confirmationstatus) as ConfirmationStatus;
    return {
      id,
      weekNumber,
      from: String(w.cfm_weekfrom || fallback.from),
      to: String(w.cfm_weekto || fallback.to),
      plan: N(w.cfm_plan),
      mix,
      status: status === STATUS_CONFIRMED || status === STATUS_CHANGE_REQUESTED ? status : STATUS_PENDING,
      agentConfirmed: !!w.cfm_agentconfirmed,
      confirmedOn: String(w.cfm_confirmedon || ''),
      confirmedByName: formattedValue(w, '_cfm_confirmedby_value'),
      employeeId,
      ownerName: employeeNames.get(employeeId) || formattedValue(brk, '_stf_employee_value') || '(task owner)',
      achievementId: brk?._stf_total_value || '',
    };
  });
  plans.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.weekNumber - b.weekNumber);

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const activities: ActivityRow[] = visitRows.map((v) => {
    const agentIds = [v._cr301_agent_value, v._cfm_agent2_value].filter((x): x is string => typeof x === 'string' && !!x);
    const employeeIds = agentIds.map((id) => agentById.get(id)?.employeeId || '').filter(Boolean);
    const objectives = parseMultiChoice(v.cr18c_objective);
    const outcomes = parseMultiChoice(v.cr18c_outcome);
    return {
      id: String(v.cr301_visitid),
      date: String(v.cr301_visitdate || ''),
      accountName: formattedValue(v, '_cr301_account_value') || '—',
      agentIds,
      employeeIds,
      agentName:
        agentIds.map((id) => agentById.get(id)?.name || '').filter(Boolean).join(' & ') ||
        formattedValue(v, '_cr301_agent_value') ||
        '—',
      objectives,
      objectiveLabel: optionLabels(OBJECTIVE_OPTIONS, objectives).join(', '),
      outcomes,
      outcomeLabels: optionLabels(OUTCOME_OPTIONS, outcomes),
      reviewed: !!v.cfm_reviewed,
      reviewedOn: String(v.cfm_reviewedon || ''),
      reviewedByName: formattedValue(v, '_cfm_reviewedby_value'),
      achievementId: employeeIds.map((e) => achievementByEmployee.get(e)).find(Boolean) || achIds[0] || '',
    };
  });

  return {
    plans,
    activities,
    messages: messageRows.map(toMessage),
    achievementByEmployee,
    defaultAchievementId: achIds[0] || '',
  };
}

// ---- writes ----
/** The signed-in person, under every id a "who did it" lookup might target. */
export interface Actor {
  systemUserId: string;
  employeeId: string;
  agentId: string;
}

/**
 * cfm_Sender / cfm_Confirmedby / cfm_reviewedby target User (systemuser) — a
 * bind to any other table fails with "Entity 'SystemUser' … does not exist".
 * Writes go out with every @odata.bind key in the same create/update body
 * (the WeeklyTargets.tsx pattern): a separate bind-afterwards PATCH was seen
 * to report success here without applying anything. If the person bind is
 * rejected, the write is retried once without it so the action still lands.
 */
function personBind(nav: string, actor: Actor | null | undefined): Record<string, string> {
  return actor?.systemUserId ? { [`${nav}@odata.bind`]: `/systemusers(${actor.systemUserId})` } : {};
}
async function writeWithPerson(
  run: (body: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: unknown }>,
  body: Record<string, unknown>,
  person: Record<string, string>,
  fallback: string
): Promise<unknown> {
  let res = await run({ ...body, ...person });
  if (!res.success && Object.keys(person).length) res = await run(body);
  if (!res.success) throw new Error(operationErrorMessage(res.error, fallback));
  return res.data;
}

export interface NewMessage {
  threadType: ThreadType;
  planWeekId?: string;
  activityId?: string;
  achievementId?: string;
  sender?: Actor;
  senderRole: SenderRole;
  type: MessageType;
  body: string;
  suggestedMix?: ObjectiveMix;
}

/** Creates the message with its lookups bound in the same body. */
export async function createMessage(m: NewMessage): Promise<Message> {
  const body: Record<string, unknown> = {
    cfm_name: m.body.slice(0, 50) || '(message)',
    cfm_threadtype: m.threadType,
    cfm_senderrole: m.senderRole,
    cfm_messagetype: m.type,
    cfm_body: m.body,
    cfm_isread: false,
  };
  if (m.suggestedMix) body.cfm_suggestedmix = mixToJson(m.suggestedMix);
  if (m.planWeekId) body['cfm_PlanWeek@odata.bind'] = `/cfm_collectionplanweeks(${m.planWeekId})`;
  if (m.activityId) body['cfm_Activity@odata.bind'] = `/cr301_visits(${m.activityId})`;
  if (m.achievementId) body['cfm_KPIAchievement@odata.bind'] = `/pm_kpiachievments(${m.achievementId})`;
  const data = await writeWithPerson(
    (b) => Cfm_activitymessagesService.create(b as unknown as Omit<Cfm_activitymessagesBase, 'cfm_activitymessageid'>),
    body,
    personBind('cfm_Sender', m.sender),
    'Could not send the message.'
  );
  const created = data as Record<string, unknown>;
  const id = String(created?.cfm_activitymessageid || '');
  if (!id) throw new Error('Message was created but no id was returned.');

  return {
    id,
    threadType: m.threadType,
    planWeekId: m.planWeekId || '',
    activityId: m.activityId || '',
    senderId: m.sender?.systemUserId || '',
    senderName: '',
    senderRole: m.senderRole,
    type: m.type,
    body: m.body,
    suggestedMix: m.suggestedMix || null,
    isRead: false,
    createdOn: String(created?.createdon || new Date().toISOString()),
  };
}

export async function markRead(ids: string[]): Promise<void> {
  const results = await Promise.all(ids.map((id) => Cfm_activitymessagesService.update(id, { cfm_isread: true })));
  const failed = results.find((r) => !r.success);
  if (failed) throw new Error(operationErrorMessage(failed.error, 'Could not mark messages as read.'));
}

export async function updateConfirmation(weekId: string, status: ConfirmationStatus, by: Actor | null): Promise<string> {
  const confirmed = status === STATUS_CONFIRMED;
  const on = confirmed ? new Date().toISOString() : '';
  const patch: Record<string, unknown> = {
    cfm_confirmationstatus: status,
    cfm_agentconfirmed: confirmed,
    cfm_confirmedon: confirmed ? on : null,
  };
  await writeWithPerson(
    (b) => Cfm_collectionplanweeksService.update(weekId, b as unknown as Partial<Omit<Cfm_collectionplanweeksBase, 'cfm_collectionplanweekid'>>),
    patch,
    confirmed ? personBind('cfm_Confirmedby', by) : {},
    'Could not update the confirmation.'
  );
  if (!confirmed) await bindLookups(WEEKS_TABLE, weekId, { cfm_Confirmedby: null }).catch(() => undefined);
  return on;
}

export async function updateReviewed(visitId: string, reviewed: boolean, by: Actor | null): Promise<string> {
  const on = reviewed ? new Date().toISOString() : '';
  const patch: Record<string, unknown> = { cfm_reviewed: reviewed, cfm_reviewedon: reviewed ? on : null };
  await writeWithPerson(
    (b) => Cr301_visitsService.update(visitId, b as unknown as Partial<Omit<Cr301_visitsBase, 'cr301_visitid'>>),
    patch,
    reviewed ? personBind('cfm_reviewedby', by) : {},
    'Could not update the review.'
  );
  if (!reviewed) await bindLookups(VISITS_TABLE, visitId, { cfm_reviewedby: null }).catch(() => undefined);
  return on;
}
