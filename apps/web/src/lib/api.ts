import type { RestaurantDetail, RestaurantIndex } from '../types';

// Static data published by the pipeline into public/data/ — served by this
// same site, so all fetches are relative.
async function fetchJson<T>(path: string): Promise<T> {
  const resp = await fetch(`/data${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
  // A missing file can come back as an HTML page (SPA fallback on some
  // hosts); treat anything that isn't JSON as not found.
  const type = resp.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(`Not JSON for ${path}`);
  return resp.json() as Promise<T>;
}

export async function fetchIndex(): Promise<RestaurantIndex> {
  return applySeverityRules(await fetchJson<RestaurantIndex>('/index.json'));
}

/**
 * Data written before severity rules 2 flagged SD DOH restaurants as having
 * critical violations from a rule-section mapping that did not hold up (see
 * docs/dinesafe-update-plan.md). Until the pipeline has reindexed every file
 * (it then stamps severity_rules: 2), those flags are not shown. Sioux Falls
 * flags come from the city's own headings and are always kept.
 */
export function applySeverityRules(index: RestaurantIndex): RestaurantIndex {
  if ((index.severity_rules ?? 1) >= 2) return index;
  return {
    ...index,
    restaurants: index.restaurants.map((r) =>
      r.source === 'sd_doh' && r.has_critical_violations
        ? { ...r, has_critical_violations: false }
        : r
    ),
  };
}

export function fetchRestaurant(id: string): Promise<RestaurantDetail> {
  return fetchJson<RestaurantDetail>(`/r/${encodeURIComponent(id)}.json`);
}
