/** Values the UI treats as a binary Yes / No decision. */
export type OutcomeKind = 'yes' | 'no' | boolean | string | null | undefined;

/** Normalise assorted API shapes into yes, no, or unknown. */
export function normaliseOutcome(value: OutcomeKind): 'yes' | 'no' | null {
  if (value === true || value === 'yes' || value === 'Yes' || value === 'YES') {
    return 'yes';
  }
  if (value === false || value === 'no' || value === 'No' || value === 'NO') {
    return 'no';
  }
  return null;
}

/** Default label for a normalised outcome. */
export function outcomeDisplayLabel(kind: 'yes' | 'no' | null): string {
  if (kind === 'yes') {
    return 'Yes';
  }
  if (kind === 'no') {
    return 'No';
  }
  return '—';
}
