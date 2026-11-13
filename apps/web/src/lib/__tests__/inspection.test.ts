import { describe, expect, it } from 'vitest';
import {
  findingsSentence,
  inspectionFindings,
  latestStatus,
  latestStatusLabel,
  severityBasis,
  severityLabel,
} from '../inspection';
import { officialSource } from '../sources';
import { TIERS, NO_SCORE_THEME, contrastRatio, getScoreTheme } from '../../scoring';

const v = (code: string, severity: 'critical' | 'major' | 'minor') => ({
  code,
  severity,
  description: 'x',
  corrected: false,
});

describe('severity provenance', () => {
  it('treats SWEEPS and scoresheet marks as official, rule-section codes as derived', () => {
    expect(severityBasis('sf_sweeps', '12')).toBe('sweeps');
    expect(severityBasis('sd_doh', '30')).toBe('scoresheet');
    expect(severityBasis('sd_doh', '44:02:07:24')).toBe('code-section');
    // Unrecognized code shapes are never promoted to "official"
    expect(severityBasis('sd_doh', 'ABC')).toBe('code-section');
  });

  it('labels official non-critical items without inventing major/minor', () => {
    expect(severityLabel(v('30', 'critical'), 'sd_doh')).toBe('Critical');
    expect(severityLabel(v('23', 'minor'), 'sd_doh')).toBe('Non-critical');
    expect(severityLabel(v('7', 'minor'), 'sf_sweeps')).toBe('Non-critical');
    expect(severityLabel(v('44:02:07:55', 'major'), 'sd_doh')).toBe('Major');
    expect(severityLabel(v('44:02:07:70', 'minor'), 'sd_doh')).toBe('Minor');
  });
});

describe('inspectionFindings', () => {
  it('counts itemized violations and criticals', () => {
    const f = inspectionFindings({
      violations: [v('44:02:07:24', 'critical'), v('44:02:07:55', 'major')],
      violation_count: 2,
    });
    expect(f).toEqual({ kind: 'itemized', count: 2, critical: 1 });
    expect(findingsSentence(f)).toBe('2 violations recorded on this inspection, 1 labeled critical.');
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
