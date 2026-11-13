import { describe, expect, it } from 'vitest';
import {
  detailProblem,
  parseSweepsDetail,
  parseViolationCount,
  shouldFetchSweepsDetail,
  sweepsViolationCount,
} from '../parsing';
import { dohRunComplete, dohRunRecord } from '../run-record';
import { publishedSeverity } from '../store';

describe('SD DOH violation count (R2)', () => {
  it('reads an explicit count, including an explicit zero', () => {
    expect(parseViolationCount('Violation(s) 5')).toBe(5);
    expect(parseViolationCount('Violation(s) 0')).toBe(0);
  });

  it('keeps a missing or unreadable count unknown instead of zero', () => {
    expect(parseViolationCount('')).toBeNull();
    expect(parseViolationCount(null)).toBeNull();
    expect(parseViolationCount(undefined)).toBeNull();
    expect(parseViolationCount('Violation(s)')).toBeNull();
    expect(parseViolationCount('n/a')).toBeNull();
  });
});

const detail = (blocks: string) => `<html><title>Food Service Inspections - City of Sioux Falls, SD</title><body nonformattednameaddress="X 1 MAIN Sioux Falls, SD 57104 (605) 555-0100 ">Facility: X ${blocks}</body></html>`;
const inspection = (date: string, score: number, body = '') =>
  `<div class="inspection">Inspection Date: ${date}<br />Total Score: ${score}${body}</div>`;
const critical = `<div class="violhead"><b>Critical Violations</b><table class="violations"><tr><td>4 points: <a href='x/violation/12'>Cold holding</a></td></tr><tr><td>Cooler at 46F</td></tr></table></div>`;
const nonCritical = `<div class="violhead"><b>Non-Critical Violations</b><table class="violations"><tr><td>1 points: <a href='x/violation/40'>Floors</a></td></tr><tr><td>Floor dirty</td></tr></table></div>`;

describe('SWEEPS detail parsing', () => {
  it('reads date, score, phone, and violations under the city’s own headings', () => {
    const { inspections, phone } = parseSweepsDetail(detail(inspection('8/11/2026', 95, critical + nonCritical)));
    expect(phone).toBe('(605) 555-0100');
    expect(inspections).toHaveLength(1);
    expect(inspections[0].date).toBe('2026-08-11');
    expect(inspections[0].score).toBe(95);
    expect(inspections[0].violations.map((v) => [v.code, v.severity])).toEqual([
      ['12', 'critical'],
      ['40', 'minor'],
    ]);
    expect(inspections[0].violationCount).toBe(2);
  });

  it('infers zero from a score of 100 only when the report lists nothing at all (R2)', () => {
    const { inspections } = parseSweepsDetail(detail(inspection('2/11/2026', 100) + inspection('1/5/2025', 93)));
    expect(inspections.map((i) => i.violationCount)).toEqual([0, null]);
    expect(sweepsViolationCount(0, null)).toBeNull();
    expect(sweepsViolationCount(3, 100)).toBe(3);
  });

  it('does not infer zero when violation markup is present but unreadable', () => {
    const broken = '<div class="violhead"><b>Critical Violations</b><table class="violations"><tr><td>layout changed</td></tr></table></div>';
    const { inspections } = parseSweepsDetail(detail(inspection('2/11/2026', 100, broken)));
    expect(inspections[0].violationCount).toBeNull();
  });

  it('takes an explicit “No Violations” statement as zero at any score', () => {
    const stated = '<table class="violations"><tr><td>No Violations</td></tr></table>';
    const { inspections } = parseSweepsDetail(detail(inspection('2/11/2026', 98, stated)));
    expect(inspections[0].violationCount).toBe(0);
  });
});

describe('unreadable SWEEPS responses (R4)', () => {
  it('rejects an HTTP-200 page that is not an establishment page', () => {
    const html = '<html>temporarily unavailable</html>';
    expect(detailProblem(html, parseSweepsDetail(html), 100)).toMatch(/not a SWEEPS establishment page/);
  });

  it('rejects a page with a listed score but no inspection, or an unreadable inspection block', () => {
    const empty = detail('');
    expect(detailProblem(empty, parseSweepsDetail(empty), 100)).toMatch(/no inspection/);
    const garbled = detail('<div class="inspection">Inspection Date: soon</div>');
    expect(detailProblem(garbled, parseSweepsDetail(garbled), null)).toMatch(/could not be read/);
  });

  it('accepts a real page, and an establishment with no score and no inspections yet', () => {
    const ok = detail(inspection('2/11/2026', 100));
    expect(detailProblem(ok, parseSweepsDetail(ok), 100)).toBeNull();
    const none = detail('');
    expect(detailProblem(none, parseSweepsDetail(none), null)).toBeNull();
  });
});

describe('SWEEPS detail refresh (R3)', () => {
  const base = { isNew: false, listScore: 100, knownScore: 100, siteId: '123', dayNumber: 0, cycleDays: 7, allDetails: false };

  it('still reads new and changed-score establishments immediately', () => {
    expect(shouldFetchSweepsDetail({ ...base, isNew: true })).toBe('new');
    expect(shouldFetchSweepsDetail({ ...base, listScore: 97 })).toBe('score-changed');
    expect(shouldFetchSweepsDetail({ ...base, allDetails: true })).toBe('all');
  });

  it('re-reads a same-score establishment exactly once per cycle', () => {
    const hits = Array.from({ length: 7 }, (_, day) => shouldFetchSweepsDetail({ ...base, dayNumber: 20000 + day }));
    expect(hits.filter((h) => h === 'rotation')).toHaveLength(1);
    expect(hits.filter((h) => h === null)).toHaveLength(6);
  });

  it('covers every establishment within one cycle, including ones with no list score', () => {
    for (let site = 1; site <= 200; site++) {
      const days = Array.from({ length: 7 }, (_, day) =>
        shouldFetchSweepsDetail({ ...base, siteId: String(site), listScore: null, knownScore: null, dayNumber: 20000 + day })
      );
      expect(days.filter(Boolean), `site ${site}`).toHaveLength(1);
    }
  });

  it('spreads the load: about one seventh of establishments per day', () => {
    const today = Array.from({ length: 1400 }, (_, i) => shouldFetchSweepsDetail({ ...base, siteId: String(i + 1), dayNumber: 20003 }));
    expect(today.filter(Boolean)).toHaveLength(200);
  });
});

describe('run records (R4)', () => {
  it('is a success only when every county was read', () => {
    expect(dohRunRecord({ restaurants: 5, inspections: 9 }, { failedCounties: [], failedRecords: [] })).toMatchObject({ status: 'success', error: null });
  });

  it('is partial when a single establishment, its violations, or its history could not be read', () => {
    const run = dohRunRecord(
      { restaurants: 5, inspections: 9 },
      { failedCounties: [], failedRecords: ['ZESTO (establishment)', 'ARBYS 8261 (violations)'] }
    );
    expect(run.status).toBe('partial');
    expect(run.error).toContain('2 record(s) could not be fully read: ZESTO (establishment); ARBYS 8261 (violations)');
    expect(dohRunComplete({ failedCounties: [], failedRecords: ['x'] })).toBe(false);
    expect(dohRunComplete({ failedCounties: [], failedRecords: [] })).toBe(true);
  });

  it('records a partial run and names what was missed', () => {
    const run = dohRunRecord({ restaurants: 5, inspections: 9 }, { failedCounties: ['Pennington', 'Hughes'] });
    expect(run.status).toBe('partial');
    expect(run.error).toContain('Pennington, Hughes');
    expect(run.restaurants_upserted).toBe(5); // progress is still reported
  });
});

describe('published severity (R1)', () => {
  it('keeps official marks and leaves portal citations unclassified', () => {
    expect(publishedSeverity('sf_sweeps', '12', 'critical')).toBe('critical');
    expect(publishedSeverity('sd_doh', '30', 'critical')).toBe('critical');
    expect(publishedSeverity('sd_doh', '23', 'minor')).toBe('minor');
    for (const stale of ['critical', 'major', 'minor']) {
      expect(publishedSeverity('sd_doh', '44:02:07:24', stale)).toBe('unclassified');
    }
  });
});
