import { Cr301_contactpersonsService } from '../generated/services/Cr301_contactpersonsService';
import type {
  Cr301_contactpersonsBase,
  Cr301_contactpersonscr301_department,
  Cr301_contactpersonsms_role,
} from '../generated/models/Cr301_contactpersonsModel';
import { operationErrorMessage } from './errors';

/**
 * Stakeholders = cr301_contactperson rows linked to a cr301_account through the
 * ms_AccountName lookup (confirmed target: cr301_account). cr301_SubAccount points
 * at the separate cr301_subaccount table and is not used by this app.
 */
const ACCOUNT_NAV = 'ms_AccountName';
const ACCOUNT_VALUE_FIELD = '_ms_accountname_value';

export const DEPARTMENT_OPTIONS: { value: Cr301_contactpersonscr301_department; label: string }[] = [
  { value: 983080000, label: 'Management' },
  { value: 983080001, label: 'HR' },
  { value: 983080002, label: 'Finance' },
  { value: 983080003, label: 'Medical' },
];

export const ROLE_OPTIONS: { value: Cr301_contactpersonsms_role; label: string }[] = [
  { value: 124700000, label: 'Owner / Managing Partner' },
  { value: 124700001, label: 'Medical Director' },
  { value: 124700002, label: 'Hospital Manager' },
  { value: 124700003, label: 'Clinic Manager' },
  { value: 124700004, label: 'Head of Department' },
  { value: 124700005, label: 'Consultant Physician' },
  { value: 124700006, label: 'Referral Coordinator' },
  { value: 124700007, label: 'Nursing Manager' },
  { value: 124700008, label: 'Procurement Officer' },
  { value: 124700009, label: 'Insurance / Claims Officer' },
  { value: 124700010, label: 'Finance Manager' },
  { value: 124700011, label: 'Marketing Officer' },
  { value: 124700012, label: 'Front Desk / Reception' },
  { value: 124700013, label: 'Broker / Agent' },
  { value: 124700014, label: 'Other' },
];

export interface Stakeholder {
  id: string;
  accountId: string;
  name: string;
  role: number | null;
  roleLabel: string;
  department: number | null;
  departmentLabel: string;
  phone: string;
  email: string;
}

export interface StakeholderInput {
  name: string;
  role: number | null;
  department: number;
  phone: string;
  email: string;
}

function labelOf(options: { value: number; label: string }[], value: number | null | undefined): string {
  if (value == null) return '';
  return options.find((o) => o.value === value)?.label || '';
}

/** All active stakeholders that are linked to an account, grouped by account id. */
export async function fetchStakeholdersByAccount(): Promise<Map<string, Stakeholder[]>> {
  const result = await Cr301_contactpersonsService.getAll({
    select: ['cr301_contactpersonid', 'cr301_newcolumn', 'ms_role', 'cr301_department', 'cr301_phone', 'cr301_email', ACCOUNT_VALUE_FIELD],
    filter: `${ACCOUNT_VALUE_FIELD} ne null and statecode eq 0`,
    orderBy: ['cr301_newcolumn asc'],
  });
  if (!result.success) throw new Error(operationErrorMessage(result.error, 'Could not load stakeholders.'));
  const byAccount = new Map<string, Stakeholder[]>();
  (result.data || []).forEach((r) => {
    const raw = r as unknown as Record<string, unknown>;
    const accountId = (raw[ACCOUNT_VALUE_FIELD] as string) || '';
    if (!accountId) return;
    const s: Stakeholder = {
      id: r.cr301_contactpersonid,
      accountId,
      name: (r.cr301_newcolumn || '').trim() || '(unnamed)',
      role: r.ms_role ?? null,
      roleLabel: labelOf(ROLE_OPTIONS, r.ms_role),
      department: r.cr301_department ?? null,
      departmentLabel: labelOf(DEPARTMENT_OPTIONS, r.cr301_department),
      phone: r.cr301_phone || '',
      email: r.cr301_email || '',
    };
    const list = byAccount.get(accountId);
    if (list) list.push(s);
    else byAccount.set(accountId, [s]);
  });
  return byAccount;
}

function plainFields(input: StakeholderInput): Record<string, unknown> {
  const name = input.name.trim();
  return {
    cr301_newcolumn: name,
    ms_name: name.slice(0, 100),
    ms_role: input.role,
    cr301_department: input.department,
    cr301_phone: input.phone.trim() || null,
    cr301_email: input.email.trim() || null,
  };
}

export async function createStakeholder(accountId: string, input: StakeholderInput): Promise<void> {
  const body = { ...plainFields(input), [`${ACCOUNT_NAV}@odata.bind`]: `/cr301_accounts(${accountId})` };
  const result = await Cr301_contactpersonsService.create(body as unknown as Omit<Cr301_contactpersonsBase, 'cr301_contactpersonid'>);
  if (!result.success) throw new Error(operationErrorMessage(result.error, 'Could not add stakeholder.'));
}

/** The account link never changes on edit, so only plain fields are sent. */
export async function updateStakeholder(id: string, input: StakeholderInput): Promise<void> {
  const result = await Cr301_contactpersonsService.update(id, plainFields(input) as unknown as Partial<Omit<Cr301_contactpersonsBase, 'cr301_contactpersonid'>>);
  if (!result.success) throw new Error(operationErrorMessage(result.error, 'Could not update stakeholder.'));
}

export async function deleteStakeholder(id: string): Promise<void> {
  await Cr301_contactpersonsService.delete(id);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}
