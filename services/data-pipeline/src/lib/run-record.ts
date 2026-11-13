/**
 * Run record for an SD DOH pass: partial when any county, or any single
 * establishment (or its violations or history), could not be read.
 */
export function dohRunRecord(
  stats: { restaurants: number; inspections: number },
  failed: { failedCounties: string[]; failedRecords?: string[] }
) {
  const counties = failed.failedCounties;
  const records = failed.failedRecords ?? [];
  const problems: string[] = [];
  if (counties.length) problems.push(`${counties.length} county(ies) could not be read: ${counties.join(', ')}`);
  if (records.length) {
    problems.push(
      `${records.length} record(s) could not be fully read: ${records.slice(0, 10).join('; ')}${records.length > 10 ? '; …' : ''}`
    );
  }
  return {
    status: problems.length > 0 ? ('partial' as const) : ('success' as const),
    restaurants_upserted: stats.restaurants,
    inspections_upserted: stats.inspections,
    error: problems.length > 0 ? problems.join(' | ') : null,
  };
}

/** True when a state run missed nothing it was asked to read. */
export function dohRunComplete(failed: { failedCounties: string[]; failedRecords: string[] }): boolean {
  return failed.failedCounties.length === 0 && failed.failedRecords.length === 0;
}
