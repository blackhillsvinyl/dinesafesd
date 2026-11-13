/** Run record for an SD DOH pass: partial when any county could not be read. */
export function dohRunRecord(
  stats: { restaurants: number; inspections: number },
  failedCounties: string[]
) {
  return {
    status: failedCounties.length > 0 ? ('partial' as const) : ('success' as const),
    restaurants_upserted: stats.restaurants,
    inspections_upserted: stats.inspections,
    error:
      failedCounties.length > 0
        ? `${failedCounties.length} county(ies) could not be read: ${failedCounties.join(', ')}`
        : null,
  };
}
