import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
