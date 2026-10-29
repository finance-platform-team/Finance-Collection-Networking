import type { Cr301_visitscr18c_objective, Cr301_visitscr18c_outcome } from '../generated/models/Cr301_visitsModel';

/**
 * cr18c_objective / cr18c_outcome labels as configured in Dataverse. Objective is a
 * global choice shared with cfm_planweekobjective, so the same values key both
 * an activity's objectives and a plan week's per-objective target.
 */
export const OBJECTIVE_OPTIONS: { value: Cr301_visitscr18c_objective; label: string }[] = [
  { value: 1, label: 'Collection' },
  { value: 2, label: 'Dispute Resolution' },
  { value: 3, label: 'Follow-up' },
  { value: 4, label: 'Reconciliation for Deduction' },
];

export const OUTCOME_OPTIONS: { value: Cr301_visitscr18c_outcome; label: string }[] = [
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

/**
 * cr18c_objective / cr18c_outcome are multi-select choices: the Web API reads
 * and writes them as a comma-separated string ("1,3"). The generated model
 * types them as a single value, so accept anything and normalise to numbers.
 */
export function parseMultiChoice(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'number') return [raw];
  return String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** Multi-select write value, in option order; null clears the column. */
export function toMultiChoice(options: { value: number }[], values: number[]): string | null {
  const picked = options.filter((o) => values.includes(o.value)).map((o) => o.value);
  return picked.length ? picked.join(',') : null;
}

/** Labels for the picked values, in option order. */
export function optionLabels(options: { value: number; label: string }[], values: number[]): string[] {
  return options.filter((o) => values.includes(o.value)).map((o) => o.label);
}
