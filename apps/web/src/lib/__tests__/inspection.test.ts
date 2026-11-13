import { describe, expect, it } from 'vitest';
import {
  findingsSentence,
  inspectionFindings,
  latestStatus,
  latestStatusLabel,
  publishedSeverity,
  severityBasis,
  severityLabel,
} from '../inspection';
import { applySeverityRules, NotFoundError, shouldRetry } from '../api';
import { sourceNotices } from '../sourceHealth';
import type { RestaurantIndex } from '../../types';
import { officialSource } from '../sources';
import { TIERS, NO_SCORE_THEME, contrastRatio, getScoreTheme } from '../../scoring';

const v = (code: string, severity: 'critical' | 'major' | 'minor' | 'unclassified') => ({
  code,
  severity,
  description: 'x',
  corrected: false,
});

describe('severity provenance', () => {
  it('treats SWEEPS and scoresheet marks as official, portal citations as unpublished', () => {
    expect(severityBasis('sf_sweeps', '12')).toBe('sweeps');
    expect(severityBasis('sd_doh', '30')).toBe('scoresheet');
    expect(severityBasis('sd_doh', '44:02:07:24')).toBe('portal');
    // Unrecognized code shapes are never promoted to "official"
    expect(severityBasis('sd_doh', 'ABC')).toBe('portal');
  });

  it('labels only what the official record states', () => {
    expect(severityLabel(v('30', 'critical'), 'sd_doh')).toBe('Critical');
    expect(severityLabel(v('23', 'minor'), 'sd_doh')).toBe('Non-critical');
    expect(severityLabel(v('7', 'minor'), 'sf_sweeps')).toBe('Non-critical');
    expect(severityLabel(v('44:02:07:55', 'unclassified'), 'sd_doh')).toBe('Severity not published');
  });

  it('ignores severities that older data files assigned to portal citations', () => {
    for (const stale of ['critical', 'major', 'minor'] as const) {
      expect(publishedSeverity(v('44:02:07:24', stale), 'sd_doh')).toBe('not-published');
    }
  });
});

describe('inspectionFindings', () => {
  it('never counts a portal citation as critical, whatever the file says', () => {
    const f = inspectionFindings(
      { violations: [v('44:02:07:24', 'critical'), v('44:02:07:55', 'major')], violation_count: 2 },
      'sd_doh'
    );
    expect(f).toEqual({ kind: 'itemized', count: 2, critical: 0, unpublished: 2, listed: null });
    expect(findingsSentence(f)).toBe(
      '2 violations recorded on this inspection. The state portal does not publish a severity for them.'
    );
  });

  it('counts official critical marks', () => {
    const f = inspectionFindings(
      { violations: [v('30', 'critical'), v('23', 'minor')], violation_count: 2 },
      'sd_doh'
    );
    expect(f).toEqual({ kind: 'itemized', count: 2, critical: 1, unpublished: 0, listed: null });
    expect(findingsSentence(f)).toBe('2 violations recorded on this inspection, 1 marked critical.');
    const sf = inspectionFindings({ violations: [v('7', 'minor')], violation_count: 1 }, 'sf_sweeps');
    expect(findingsSentence(sf)).toBe('1 violation recorded on this inspection; none marked critical.');
  });

  it('only says none recorded on an explicit zero count', () => {
    expect(inspectionFindings({ violations: [], violation_count: 0 }).kind).toBe('none-recorded');
    expect(inspectionFindings({ violations: [], violation_count: null }).kind).toBe('unknown');
    expect(inspectionFindings({ violations: [] }).kind).toBe('unknown');
  });

  it('reports severity as unknown when only a count is published', () => {
    const f = inspectionFindings({ violations: [], violation_count: 3 });
    expect(f).toEqual({ kind: 'count-only', count: 3 });
    expect(findingsSentence(f)).toMatch(/severity is unknown/);
  });
});

describe('source count versus itemized rows (R6)', () => {
  it('states both when the record counts more than it itemizes', () => {
    const f = inspectionFindings(
      { violations: [v('44:02:07:24', 'unclassified'), v('44:02:07:55', 'unclassified')], violation_count: 5 },
      'sd_doh'
    );
    expect(f).toMatchObject({ count: 2, listed: 5 });
    expect(findingsSentence(f)).toBe(
      'The official record counts 5 violations for this inspection and itemizes 2. The state portal does not publish a severity for the itemized ones.'
    );
  });

  it('states both when it itemizes more than it counts, without a blanket severity claim', () => {
    const f = inspectionFindings({ violations: [v('30', 'critical'), v('23', 'minor')], violation_count: 1 }, 'sd_doh');
    expect(findingsSentence(f)).toBe(
      'The official record counts 1 violation for this inspection and itemizes 2, 1 marked critical.'
    );
    const none = inspectionFindings({ violations: [v('22', 'minor'), v('23', 'minor')], violation_count: 3 }, 'sd_doh');
    expect(findingsSentence(none)).toBe(
      'The official record counts 3 violations for this inspection and itemizes 2; none of the itemized ones marked critical.'
    );
  });
});

describe('Sioux Falls zero read from the score', () => {
  it('says so on the report, and only for a 100 score from the city', () => {
    const none = inspectionFindings({ violations: [], violation_count: 0 }, 'sf_sweeps');
    expect(findingsSentence(none, { source: 'sf_sweeps', score: 100 })).toBe(
      'No violations are listed on the city’s report for this inspection, which scored 100.'
    );
    expect(findingsSentence(none, { source: 'sf_sweeps', score: 98 })).toBe('No violations were recorded on this inspection.');
    expect(findingsSentence(none, { source: 'sd_doh', score: 100 })).toBe('No violations were recorded on this inspection.');
  });
});

describe('load failures (R7)', () => {
  it('never retries a missing record, and gives up on outages after two retries', () => {
    expect(shouldRetry(0, new NotFoundError('/r/x.json'))).toBe(false);
    expect(shouldRetry(0, new Error('HTTP 503'))).toBe(true);
    expect(shouldRetry(1, new Error('HTTP 503'))).toBe(true);
    expect(shouldRetry(2, new Error('HTTP 503'))).toBe(false);
  });
});

describe('source health notices (R4)', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const run = (status: 'success' | 'partial' | 'failure', finished_at: string) => ({
    status,
    finished_at,
    restaurants_upserted: 1,
    inspections_upserted: 1,
    error: 'internal detail that must not be shown: ECONNRESET at county Hughes',
  });

  it('is silent when every source was fully read recently', () => {
    expect(sourceNotices({ sources: { sd_doh: run('success', '2026-11-12T06:00:00Z') } }, now)).toEqual([]);
  });

  it('says so, in plain words, when a source was only partly read or failed', () => {
    const [partial] = sourceNotices({ sources: { sd_doh: run('partial', '2026-11-12T06:00:00Z') } }, now);
    expect(partial).toMatch(/South Dakota Department of Health records .* could not read everything/);
    expect(partial).not.toMatch(/ECONNRESET|Hughes/);
    const [failed] = sourceNotices({ sources: { sf_sweeps: run('failure', '2026-11-12T06:00:00Z') } }, now);
    expect(failed).toMatch(/City of Sioux Falls records .* failed/);
  });

  it('flags a source that has not been checked for days', () => {
    const [stale] = sourceNotices({ sources: { sd_doh: run('success', '2026-11-08T18:24:05Z') } }, now);
    expect(stale).toMatch(/last checked on November 8, 2026/);
  });
});

describe('index flags from before severity rules 2', () => {
  const row = (source: string) =>
    ({ id: source, source, has_critical_violations: true }) as unknown as RestaurantIndex['restaurants'][number];
  const base = { updated_at: '', sources: {}, restaurants: [row('sd_doh'), row('sf_sweeps')] };

  it('drops unverified state flags and keeps Sioux Falls flags on older data', () => {
    const out = applySeverityRules(base);
    expect(out.restaurants.map((r) => r.has_critical_violations)).toEqual([false, true]);
  });

  it('trusts every flag once the pipeline has reindexed', () => {
    const out = applySeverityRules({ ...base, severity_rules: 2 });
    expect(out.restaurants.map((r) => r.has_critical_violations)).toEqual([true, true]);
  });
});

describe('latestStatus (index rows)', () => {
  const base = {
    has_critical_violations: false,
    violation_categories: [] as string[],
    violation_history: [] as { date: string; count: number }[],
    latest_inspection_date: '2026-07-20',
  };

  it('carries the critical flag', () => {
    expect(latestStatus({ ...base, has_critical_violations: true, violation_categories: ['pests'] }).kind).toBe(
      'critical'
    );
  });

  it('says none recorded only when the latest count is zero', () => {
    const s = latestStatus({ ...base, violation_history: [{ date: '2026-07-20', count: 0 }] });
    expect(latestStatusLabel(s)).toBe('No violations recorded');
  });

  it('does not reuse an older inspection’s zero count', () => {
    const s = latestStatus({ ...base, violation_history: [{ date: '2025-01-01', count: 0 }] });
    expect(s.kind).toBe('unknown');
    expect(latestStatusLabel(s)).toBe('Violation details not available');
  });

  it('reports a count without categories as violations, not clean', () => {
    const s = latestStatus({ ...base, violation_history: [{ date: '2026-07-20', count: 4 }] });
    expect(latestStatusLabel(s)).toBe('4 violations recorded');
  });
});

describe('official source links', () => {
  it('deep links SWEEPS records by site id', () => {
    const s = officialSource({ id: 'sf_sweeps_715', source: 'sf_sweeps' });
    expect(s.deepLink).toBe(true);
    expect(s.url).toBe(
      'https://sweepsdata.siouxfalls.gov/Restaurant_Detail.aspx?SiteID=715&FacType=16F&inv=1'
    );
  });

  it('falls back to the public search for the state portal', () => {
    const s = officialSource({ id: 'sd_doh_x', source: 'sd_doh' });
    expect(s.deepLink).toBe(false);
    expect(s.url).toMatch(/publicinspectionsearch\.aspx$/);
  });
});

describe('score colors', () => {
  it('keeps score text at 4.5:1 or better on every pin color', () => {
    for (const t of [...TIERS.map((x) => x.theme), NO_SCORE_THEME]) {
      expect(contrastRatio(t.onMarker, t.markerColor)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps quick-view score text at 4.5:1 or better on its tint', () => {
    for (const t of [...TIERS.map((x) => x.theme), NO_SCORE_THEME]) {
      expect(contrastRatio(t.color, t.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reproduces the reported failure for white on the 90–95 pin', () => {
    expect(contrastRatio('#ffffff', getScoreTheme(92).markerColor)).toBeLessThan(2);
  });
});
