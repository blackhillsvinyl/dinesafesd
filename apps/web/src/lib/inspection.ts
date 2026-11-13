import type { Inspection, Restaurant, Violation } from '../types';

// What the published data does and does not establish about an inspection.
// Everything here reads fields the pipeline already publishes
// (services/data-pipeline/src/lib/store.ts) — nothing is reclassified.

/**
 * Where a violation's severity can come from:
 *
 * - 'sweeps'       City of Sioux Falls report lists it under "Critical
 *                  Violations" or "Non-Critical Violations" (sync-sioux-falls.ts).
 * - 'scoresheet'   SD DOH inspection scoresheet PDF; critical items carry the
 *                  form's "*" mark (pdf-parser.ts). Codes are item numbers 1–60.
 * - 'portal'       SD DOH portal violation cited by rule section (e.g.
 *                  "44:02:07:24"). Neither the portal nor the rule publishes a
 *                  severity for these, so none is shown — whatever value an
 *                  older data file may still carry.
 */
export type SeverityBasis = 'sweeps' | 'scoresheet' | 'portal';

export function severityBasis(source: string, code: string): SeverityBasis {
  if (source === 'sf_sweeps') return 'sweeps';
  return /^\d{1,2}$/.test(code.trim()) ? 'scoresheet' : 'portal';
}

export type PublishedSeverity = 'critical' | 'non-critical' | 'not-published';

/** The severity the official record actually states for a violation. */
export function publishedSeverity(
  v: Pick<Violation, 'severity' | 'code'>,
  source: string
): PublishedSeverity {
  if (severityBasis(source, v.code) === 'portal') return 'not-published';
  return v.severity === 'critical' ? 'critical' : 'non-critical';
}

const SEVERITY_TEXT: Record<PublishedSeverity, string> = {
  critical: 'Critical',
  'non-critical': 'Non-critical',
  'not-published': 'Severity not published',
};

/** Text shown beside a violation. */
export function severityLabel(v: Pick<Violation, 'severity' | 'code'>, source: string): string {
  return SEVERITY_TEXT[publishedSeverity(v, source)];
}

export const BASIS_SHORT: Record<SeverityBasis, string> = {
  sweeps: 'per city report',
  scoresheet: 'per state scoresheet',
  portal: 'state portal citation',
};

export const BASIS_EXPLANATION: Record<SeverityBasis, string> = {
  sweeps:
    'The City of Sioux Falls report lists each violation under “Critical Violations” or “Non-Critical Violations”. We show that grouping as published.',
  scoresheet:
    'The state inspection scoresheet marks critical items on the form. We show that mark as published; unmarked items are labeled non-critical.',
  portal:
    'The state portal cites the rule section violated (for example 44:02:07:24) but does not publish a severity, and the rule itself does not rank its sections. We show the citation and the inspector’s notes and do not assign a severity.',
};

export type Findings =
  /** The source reported a violation count of zero. */
  | { kind: 'none-recorded' }
  /**
   * Individual violations are published. `critical` counts official critical
   * marks; `unpublished` counts violations whose severity the source does
   * not state.
   */
  | {
      kind: 'itemized';
      /** Violations itemized in the record. */
      count: number;
      critical: number;
      unpublished: number;
      /** The source's own count when it differs from the itemized rows, else null. */
      listed: number | null;
    }
  /** Only a count is published; severity cannot be known. */
  | { kind: 'count-only'; count: number }
  /** Neither violations nor a count are published. */
  | { kind: 'unknown' };

// `source` only matters for telling Sioux Falls codes from state ones; both
// official code systems are short item numbers and portal citations are not,
// so the state default gives the same answer for every record.
export function inspectionFindings(
  i: Pick<Inspection, 'violations' | 'violation_count'>,
  source = 'sd_doh'
): Findings {
  if (i.violations.length > 0) {
    const kinds = i.violations.map((v) => publishedSeverity(v, source));
    return {
      kind: 'itemized',
      count: i.violations.length,
      critical: kinds.filter((k) => k === 'critical').length,
      unpublished: kinds.filter((k) => k === 'not-published').length,
      listed:
        typeof i.violation_count === 'number' && i.violation_count !== i.violations.length
          ? i.violation_count
          : null,
    };
  }
  if (i.violation_count === 0) return { kind: 'none-recorded' };
  if (typeof i.violation_count === 'number' && i.violation_count > 0) {
    return { kind: 'count-only', count: i.violation_count };
  }
  return { kind: 'unknown' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const SWEEPS_ZERO_NOTE =
  'The city’s report prints no violation count. Where it lists no violations and the score is 100, we read that as none, because the score is 100 minus the points deducted.';

/**
 * One factual sentence (or two) about an inspection's findings. `ctx` lets
 * the full report say when a Sioux Falls zero is read from the score.
 */
export function findingsSentence(f: Findings, ctx: { source?: string; score?: number | null } = {}): string {
  switch (f.kind) {
    case 'none-recorded':
      return ctx.source === 'sf_sweeps' && ctx.score === 100
        ? 'No violations are listed on the city’s report for this inspection, which scored 100.'
        : 'No violations were recorded on this inspection.';
    case 'itemized': {
      // When the source's count and its itemized rows disagree, state both:
      // the rows may be incomplete or grouped differently, and we can't tell.
      const split = f.listed !== null;
      const head = split
        ? `The official record counts ${plural(f.listed!, 'violation')} for this inspection and itemizes ${f.count}`
        : `${plural(f.count, 'violation')} recorded on this inspection`;
      const those = split ? 'the itemized ones' : f.count === 1 ? 'it' : 'them';
      if (f.unpublished === f.count) {
        return `${head}. The state portal does not publish a severity for ${those}.`;
      }
      const marked =
        f.critical === 0
          ? `${head}; none ${split ? 'of the itemized ones ' : ''}marked critical.`
          : f.critical === f.count && !split
            ? `${head}, marked critical.`
            : `${head}, ${f.critical} marked critical.`;
      return f.unpublished > 0
        ? `${marked} No severity is published for ${f.unpublished} of them.`
        : marked;
    }
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
 * pipeline computes has_critical_violations (official critical marks only —
 * see applySeverityRules in api.ts for older data) and violation_categories
 * from the latest inspection's itemized violations, and violation_history from the
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

export const CRITICAL_FILTER_NOTE =
  'Only Sioux Falls reports and state scoresheets mark violations critical. The state portal, the source of most statewide latest inspections, does not publish a severity.';
