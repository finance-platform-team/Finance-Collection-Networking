import { useEffect, useState } from 'react';
import { getContext } from '@microsoft/power-apps/app';
import { SystemusersService } from '../generated/services/SystemusersService';
import { Hr_employeesService } from '../generated/services/Hr_employeesService';
import { Cr301_agentsService } from '../generated/services/Cr301_agentsService';
import { fetchAll } from './dataverse';
import type { AgentRef } from './activityComm';

export type UserRole = 'manager' | 'agent';

// cr301_agents.cr18c_area choice value for KSA (see Agents.tsx).
const AREA_KSA = 989230004;

export interface CurrentUser {
  systemUserId: string;
  employeeId: string;
  name: string;
  /** Page-level role: 'manager' if they manage anyone, else 'agent'. */
  role: UserRole;
  /** Has their own agent record — acts as the Agent on their own rows even
   *  when they are also a manager. */
  isAgent: boolean;
  /** hr_employee ids that are this user's own (their agent records' employees). */
  myEmployeeIds: Set<string>;
  /** cr301_agents ids that belong to this user (Task Owner on activities). */
  agentIds: string[];
  /** hr_employee ids whose rows this user may see. null = no restriction
   *  (a manager with no direct reports configured — supervisors/admins). */
  visibleEmployeeIds: Set<string> | null;
}

export interface UserContext {
  loading: boolean;
  error: string | null;
  user: CurrentUser | null;
  agents: AgentRef[];
  employeeNames: Map<string, string>;
}

/**
 * Who is looking at the page, and in which role:
 *  - the signed-in Entra user → systemuser (azureactivedirectoryobjectid) →
 *    hr_employee (hr_User lookup, falling back to email);
 *  - **Manager** when their own cr301_agents record has cfm_ismanager = Yes
 *    (managers sit in the agents table too) — they see every agent;
 *  - otherwise **Manager** of a team when collection agents' employee records
 *    have this employee as cr18c_DirectManager — they see that team;
 *  - **Agent** when an active collection cr301_agents record is linked to this
 *    employee (cfm_Employee) or user (cr301_Agent) — they see their own rows;
 *  - anyone else (supervisors/admins without direct reports) is a Manager
 *    with no team restriction.
 */
export function useCurrentUser(): UserContext {
  const [state, setState] = useState<UserContext>({ loading: true, error: null, user: null, agents: [], employeeNames: new Map() });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getContext().catch(() => null);
        const objectId = ctx?.user?.objectId || '';
        const upn = (ctx?.user?.userPrincipalName || '').toLowerCase();

        const [userRes, employeeRows, agentRows] = await Promise.all([
          objectId
            ? SystemusersService.getAll({ select: ['systemuserid', 'fullname'], filter: `azureactivedirectoryobjectid eq ${objectId}`, top: 1 })
            : Promise.resolve(null),
          fetchAll<{ hr_employeeid: string; hr_fullname?: string; hr_email?: string; hr_useremail?: string; _hr_user_value?: string; _cr18c_directmanager_value?: string }>(
            (skipToken) =>
              Hr_employeesService.getAll({
                select: ['hr_employeeid', 'hr_fullname', 'hr_email', 'hr_useremail', '_hr_user_value', '_cr18c_directmanager_value'],
                filter: 'statecode eq 0',
                maxPageSize: 5000,
                skipToken,
              }),
            'Could not load employees.'
          ),
          fetchAll<{ cr301_agentid: string; cr301_newcolumn?: string; cfm_ismanager?: boolean; cr18c_area?: number; _cfm_employee_value?: string; _cr301_agent_value?: string; _cr301_salesteam_value?: string }>(
            (skipToken) =>
              Cr301_agentsService.getAll({
                select: ['cr301_agentid', 'cr301_newcolumn', 'cfm_ismanager', 'cr18c_area', '_cfm_employee_value', '_cr301_agent_value', '_cr301_salesteam_value'],
                filter: 'cfm_iscollection eq true and statecode eq 0',
                maxPageSize: 5000,
                skipToken,
              }),
            'Could not load agents.'
          ),
        ]);

        const systemUser = userRes?.success ? userRes.data?.[0] : undefined;
        const systemUserId = systemUser?.systemuserid || '';
        const me =
          (systemUserId && employeeRows.find((e) => e._hr_user_value === systemUserId)) ||
          (upn && employeeRows.find((e) => (e.hr_useremail || e.hr_email || '').toLowerCase() === upn)) ||
          undefined;
        // Many users have no hr_employee linked through hr_User — fall back to
        // the employee on their own cr301_agents record (cr301_Agent = user).
        const myAgentByUser = systemUserId ? agentRows.find((a) => a._cr301_agent_value === systemUserId && a._cfm_employee_value) : undefined;
        const employeeId = me?.hr_employeeid || myAgentByUser?._cfm_employee_value || '';
        const meRecord = me || employeeRows.find((e) => e.hr_employeeid === employeeId);

        const agents: AgentRef[] = agentRows.map((a) => ({
          id: a.cr301_agentid,
          name: a.cr301_newcolumn || '(agent)',
          employeeId: a._cfm_employee_value || '',
          region: Number(a.cr18c_area) === AREA_KSA ? 'KSA' : 'EG',
        }));
        const agentEmployeeIds = new Set(agents.map((a) => a.employeeId).filter(Boolean));
        const myAgentRows = agentRows.filter((a) => (employeeId && a._cfm_employee_value === employeeId) || (systemUserId && a._cr301_agent_value === systemUserId));
        const myAgentIds = myAgentRows.map((a) => a.cr301_agentid);
        // cr301_Agent on the agent record is the User lookup — use it when the
        // azureactivedirectoryobjectid lookup above found nobody.
        const resolvedSystemUserId = systemUserId || myAgentRows.find((a) => a._cr301_agent_value)?._cr301_agent_value || '';
        const myEmployeeIds = new Set([employeeId, ...myAgentRows.map((a) => a._cfm_employee_value || '')].filter(Boolean));
        const team = employeeId
          ? employeeRows.filter((e) => e._cr18c_directmanager_value === employeeId && agentEmployeeIds.has(e.hr_employeeid)).map((e) => e.hr_employeeid)
          : [];

        let role: UserRole;
        let visibleEmployeeIds: Set<string> | null;
        if (myAgentRows.some((a) => a.cfm_ismanager)) {
          // Managers are kept in cr301_agents too — cfm_ismanager is what
          // tells them apart. They see every collection agent.
          role = 'manager';
          visibleEmployeeIds = null;
        } else if (team.length) {
          role = 'manager';
          visibleEmployeeIds = new Set([...team, employeeId]);
        } else if (myAgentIds.length) {
          role = 'agent';
          visibleEmployeeIds = myEmployeeIds;
        } else {
          role = 'manager';
          visibleEmployeeIds = null;
        }

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          agents,
          employeeNames: new Map(employeeRows.map((e) => [e.hr_employeeid, e.hr_fullname || '(employee)'])),
          user: {
            systemUserId: resolvedSystemUserId,
            employeeId,
            name: meRecord?.hr_fullname || systemUser?.fullname || ctx?.user?.fullName || '',
            role,
            isAgent: myAgentIds.length > 0,
            myEmployeeIds,
            agentIds: myAgentIds,
            visibleEmployeeIds,
          },
        });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
