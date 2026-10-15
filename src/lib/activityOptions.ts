import type { Cr301_visitscfm_objective, Cr301_visitscfm_outcome } from '../generated/models/Cr301_visitsModel';

/**
 * cfm_objective / cfm_outcome labels as configured in Dataverse. Objective is a
 * global choice shared with cfm_planweekobjective, so the same values key both
 * an activity's objective and a plan week's per-objective target.
 */
export const OBJECTIVE_OPTIONS: { value: Cr301_visitscfm_objective; label: string }[] = [
  { value: 1, label: 'Collection' },
  { value: 2, label: 'Dispute Resolution' },
  { value: 3, label: 'Follow-up' },
  { value: 4, label: 'Reconciliation for Deduction' },
];

export const OUTCOME_OPTIONS: { value: Cr301_visitscfm_outcome; label: string }[] = [
  { value: 766340000, label: 'Full Payment' },
  { value: 766340001, label: 'Partial Payment' },
  { value: 766340002, label: 'No Payment' },
  { value: 766340003, label: 'Just Follow-up' },
  { value: 766340004, label: 'Promise to Pay' },
  { value: 766340005, label: 'Missing Doc' },
  { value: 766340006, label: 'Escalated' },
];

export function optionLabel(options: { value: number; label: string }[], value: number | null): string {
  if (value == null) return '';
  return options.find((o) => o.value === value)?.label || '';
}
