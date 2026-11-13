import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Stand-in for the PDF parser so each stubbed "PDF" has a known outcome
vi.mock('../../sources/pdf-parser', () => ({
  parseInspectionPDF: async (buf: Buffer) => {
    const text = buf.toString();
    if (text === 'not a PDF') throw new Error('InvalidPDFException: Invalid PDF structure');
    if (text === 'no score') return { date: new Date(), score: null, violations: [], comments: '' };
    return { date: new Date(), score: 95, violations: [], comments: '' };
  },
}));

// The real syncAll → syncByCounty loop with a stubbed browser page and a
// throwaway data directory: no network, no published data touched.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dinesafe-doh-run-'));

const establishment = (name: string) => ({
  name,
  address: '1 MAIN ST',
  city: 'Pierre',
  zip: '57501',
  phone: null,
  inspectionDate: '10/01/2026',
  inspectionType: 'Routine',
  score: 96,
  violationCount: 1,
  reportButtonId: null,
  violationsLinkId: null,
  pastInspectionsLinkId: null,
});

function stubPage() {
  const evaluations: unknown[] = ['41', false]; // county option value, then "no records?" = false
  return {
    goto: async () => null,
    evaluate: async () => (evaluations.length ? evaluations.shift() : false),
    select: async () => [],
    type: async () => undefined,
    click: async () => undefined,
    waitForNavigation: async () => null,
    waitForFunction: async () => null,
    $: async () => ({}),
  };
}

describe('SD DOH run outcome (R4)', () => {
  beforeAll(() => {
    // Skip the politeness delays; nothing here talks to the portal
    vi.stubGlobal('setTimeout', (fn: () => void) => {
      queueMicrotask(fn);
      return 0;
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  async function run(process: (e: { name: string }) => Promise<void>) {
    const { SDDOHSource } = await import('../../sources/sd-doh');
    const { dohRunRecord } = await import('../run-record');
    const source = new SDDOHSource({ mode: 'full', counties: ['Hughes'] });
    const s = source as unknown as Record<string, unknown>;
    s.page = stubPage();
    s.extractEstablishments = async () => [establishment('GOOD CAFE'), establishment('BROKEN DINER'), establishment('OK GRILL')];
    s.goToNextPage = async () => false;
    const processed: string[] = [];
    s.processEstablishment = async (e: { name: string }) => {
      await process(e);
      processed.push(e.name);
    };
    const failed = await source.syncAll();
    return { failed, processed, record: dohRunRecord(source.getStats(), failed) };
  }

  it('one failing establishment among good ones makes the run partial, and the rest still run', async () => {
    const { failed, processed, record } = await run(async (e) => {
      if (e.name === 'BROKEN DINER') throw new Error('detached frame');
    });
    expect(processed).toEqual(['GOOD CAFE', 'OK GRILL']); // progress preserved
    expect(failed.failedCounties).toEqual([]);
    expect(failed.failedRecords).toEqual(['BROKEN DINER (establishment)']);
    expect(record.status).toBe('partial');
    expect(record.error).toContain('BROKEN DINER');
  });

  it('a run where everything is read is a success', async () => {
    const { failed, record } = await run(async () => undefined);
    expect(failed).toEqual({ failedCounties: [], failedRecords: [] });
    expect(record.status).toBe('success');
  });

  it('a county missing from the portal list is a failed county, not a silent skip', async () => {
    const { SDDOHSource } = await import('../../sources/sd-doh');
    const source = new SDDOHSource({ mode: 'full', counties: ['Nowhere'] });
    const page = stubPage();
    page.evaluate = async () => null; // county not in the dropdown
    (source as unknown as Record<string, unknown>).page = page;
    const failed = await source.syncAll();
    expect(failed.failedCounties).toEqual(['Nowhere']);
  });
});

describe('score backfill outcome (review finding B)', () => {
  beforeAll(() => {
    vi.stubGlobal('setTimeout', (fn: () => void) => {
      queueMicrotask(fn);
      return 0;
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  // One establishment with three scoreless past inspections, each of whose
  // report "PDF" is decided by the test.
  let fixture = 0;
  async function backfill(pdfs: Record<string, unknown>) {
    const { SDDOHSource } = await import('../../sources/sd-doh');
    const { store } = await import('../store');
    const { dohRunRecord, dohRunComplete } = await import('../run-record');
    const est = { ...establishment('BACKFILL CAFE ' + ++fixture) /* a fresh record per test: the store is shared */, inspectionDate: '', pastInspectionsLinkId: 'past_0' };
    const probe = new SDDOHSource({ mode: 'backfill-scores' }) as unknown as { generateExternalId(e: unknown): string };
    const id = probe.generateExternalId(est);
    store.upsertRestaurant({
      external_id: id, name: est.name, address: est.address, city: est.city, state: 'SD',
      latitude: 44.37, longitude: -100.35, source: 'sd_doh',
    });
    const dates = ['2025-01-10', '2025-02-10', '2025-03-10'];
    for (const date of dates) store.upsertInspection(id, { date, score: null });
    const source = new SDDOHSource({ mode: 'backfill-scores', counties: ['Hughes'], backfillTargets: new Map([[id, new Set(dates)]]) });
    const s = source as unknown as Record<string, unknown>;
    s.page = stubPage();
    s.extractEstablishments = async () => [est];
    s.goToNextPage = async () => false;
    s.extractPastInspections = async () => [
      { date: '01/10/2025', type: 'Routine', violationCount: 0, reportButtonId: 'a' },
      { date: '02/10/2025', type: 'Routine', violationCount: 0, reportButtonId: 'b' },
      { date: '03/10/2025', type: 'Routine', violationCount: 0, reportButtonId: 'c' },
    ];
    s.fetchPdfViaPostback = async (buttonId: string) => {
      const outcome = pdfs[buttonId];
      if (outcome instanceof Error) throw outcome;
      return typeof outcome === 'string' ? { kind: 'pdf', buffer: Buffer.from(outcome) } : outcome;
    };
    const failed = await source.syncAll();
    const scores = Object.fromEntries(store.getRestaurant(id)!.inspections.map((i) => [i.date, i.score]));
    return { failed, scores, stats: source.getStats(), record: dohRunRecord(source.getStats(), failed), complete: dohRunComplete(failed) };
  }

  it('an invalid PDF makes the run partial while a valid one still fills its score', async () => {
    const { failed, scores, record, complete } = await backfill({ a: 'not a PDF', b: 'valid', c: 'valid' });
    expect(scores).toEqual({ '2025-01-10': null, '2025-02-10': 95, '2025-03-10': 95 });
    expect(failed.failedRecords).toHaveLength(1);
    expect(failed.failedRecords[0]).toMatch(/report PDF for 2025-01-10/);
    expect(record.status).toBe('partial');
    expect(complete).toBe(false); // the job exits non-zero
  });

  it('a PDF with no readable score, a failed download, and a thrown request are all failures', async () => {
    const { failed, scores, record } = await backfill({
      a: 'no score',
      b: { kind: 'failed', reason: 'report download returned HTTP 500' },
      c: new Error('Execution context was destroyed'),
    });
    expect(Object.values(scores)).toEqual([null, null, null]);
    expect(failed.failedRecords).toHaveLength(3);
    expect(record.status).toBe('partial');
  });

  it('a report the portal does not offer is counted, not treated as a failure', async () => {
    const { failed, stats, record, complete } = await backfill({ a: { kind: 'not-offered' }, b: 'valid', c: { kind: 'not-offered' } });
    expect(failed.failedRecords).toEqual([]);
    expect(stats.reportsNotOffered).toBe(2);
    expect(record.status).toBe('success');
    expect(complete).toBe(true);
  });
});
