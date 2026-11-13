import type { Inspection, Restaurant, Violation } from '../types';

// What the published data does and does not establish about an inspection.
// Everything here reads fields the pipeline already publishes
// (services/data-pipeline/src/lib/store.ts) — nothing is reclassified.

/**
 * Where a violation's severity value comes from:
 *
 * - 'sweeps'       City of Sioux Falls report lists it under "Critical
 *                  Violations" or "Non-Critical Violations" (sync-sioux-falls.ts).
 * - 'scoresheet'   SD DOH inspection scoresheet PDF; critical items carry the
 *                  form's "*" mark (pdf-parser.ts). Codes are item numbers 1–60.
 * - 'code-section' SD DOH portal violation cited by rule section (e.g.
 *                  "44:02:07:24"). The portal publishes no severity, so the
 *                  pipeline assigns one from the section number
 *                  (sd-doh.ts mapSDCodeToSeverity). This is a DineSafeSD
 *                  classification, not an official one.
 */
export type SeverityBasis = 'sweeps' | 'scoresheet' | 'code-section';

export function severityBasis(source: string, code: string): SeverityBasis {
  if (source === 'sf_sweeps') return 'sweeps';
  return /^\d{1,2}$/.test(code.trim()) ? 'scoresheet' : 'code-section';
}

export function isOfficialBasis(basis: SeverityBasis): boolean {
  return basis !== 'code-section';
}

/** Text shown beside a violation. Official sources only mark critical or not. */
export function severityLabel(v: Pick<Violation, 'severity' | 'code'>, source: string): string {
  const basis = severityBasis(source, v.code);
  if (v.severity === 'critical') return 'Critical';
  if (isOfficialBasis(basis)) return 'Non-critical';
  if (v.severity === 'major') return 'Major';
  if (v.severity === 'minor') return 'Minor';
  return 'Severity not classified';
}

export const BASIS_SHORT: Record<SeverityBasis, string> = {
  sweeps: 'per city report',
  scoresheet: 'per state scoresheet',
  'code-section': 'DineSafeSD classification',
};

export const BASIS_EXPLANATION: Record<SeverityBasis, string> = {
  sweeps:
    'The City of Sioux Falls report lists each violation under “Critical Violations” or “Non-Critical Violations”. We show that grouping as published.',
  scoresheet:
    'The state inspection scoresheet marks critical items on the form. We show that mark as published; unmarked items are labeled non-critical.',
  'code-section':
    'The state portal cites a rule section (for example 44:02:07:24) but does not publish a severity level. DineSafeSD labels these Critical, Major, or Minor from the rule section cited. This is our classification, not an official one.',
};

export type Findings =
  /** The source reported a violation count of zero. */
  | { kind: 'none-recorded' }
  /** Individual violations are published, each with a severity. */
  | { kind: 'itemized'; count: number; critical: number }
  /** Only a count is published; severity cannot be known. */
  | { kind: 'count-only'; count: number }
  /** Neither violations nor a count are published. */
  | { kind: 'unknown' };

export function inspectionFindings(i: Pick<Inspection, 'violations' | 'violation_count'>): Findings {
  if (i.violations.length > 0) {
    return {
      kind: 'itemized',
      count: i.violations.length,
      critical: i.violations.filter((v) => v.severity === 'critical').length,
    };
  }
  if (i.violation_count === 0) return { kind: 'none-recorded' };
  if (typeof i.violation_count === 'number' && i.violation_count > 0) {
    return { kind: 'count-only', count: i.violation_count };
  }
  return { kind: 'unknown' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One factual sentence about an inspection's findings. */
export function findingsSentence(f: Findings): string {
  switch (f.kind) {
    case 'none-recorded':
      return 'No violations were recorded on this inspection.';
    case 'itemized':
      if (f.critical === 0) {
        return `${plural(f.count, 'violation')} recorded on this inspection; none labeled critical.`;
      }
      return f.critical === f.count
        ? `${plural(f.count, 'violation')} recorded on this inspection, labeled critical.`
        : `${plural(f.count, 'violation')} recorded on this inspection, ${f.critical} labeled critical.`;
    case 'count-only':
      return `${plural(f.count, 'violation')} recorded on this inspection. Itemized details are not published, so severity is unknown.`;
    case 'unknown':
      return 'Violation details are not available for this inspection.';
  }
}

export type LatestStatus =
  | { kind: 'critical' }
  | { kind: 'violations'; count: number | null }
  | { kind: 'none-recorded' }
  | { kind: 'unknown' };

/**
 * Same question for an index row, which carries only derived fields. The
 * pipeline computes has_critical_violations and violation_categories from the
 * latest inspection's itemized violations, and violation_history from the
 * itemized length or the published count — so "none recorded" is only
 * claimed when the latest inspection's count is an explicit zero.
 */
export function latestStatus(
  r: Pick<
    Restaurant,
    'has_critical_violations' | 'violation_categories' | 'violation_history' | 'latest_inspection_date'
  >
): LatestStatus {
  const last = r.violation_history?.[r.violation_history.length - 1];
  const count = last && last.date === r.latest_inspection_date ? last.count : null;
  if (r.has_critical_violations) return { kind: 'critical' };
  if (r.violation_categories.length > 0) return { kind: 'violations', count };
  if (count === 0) return { kind: 'none-recorded' };
  if (count !== null && count > 0) return { kind: 'violations', count };
  return { kind: 'unknown' };
}

/** Short wording for cards and feeds. */
export function latestStatusLabel(s: LatestStatus): string {
  switch (s.kind) {
    case 'critical':
      return 'Critical violation on latest inspection';
    case 'violations':
      return s.count ? `${plural(s.count, 'violation')} recorded` : 'Violations recorded';
    case 'none-recorded':
      return 'No violations recorded';
    case 'unknown':
      return 'Violation details not available';
  }
}

export const SCORE_VS_CRITICAL =
  'A high score can still include a critical violation. The score reflects the points deducted across the whole inspection; “critical” describes the kind of violation.';
