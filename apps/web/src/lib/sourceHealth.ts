import type { RestaurantIndex } from '../types';

const AGENCY: Record<string, string> = {
  sd_doh: 'South Dakota Department of Health',
  sf_sweeps: 'City of Sioux Falls',
};

// The pipeline checks each source daily; a few missed days is worth saying.
const STALE_AFTER_DAYS = 3;

/**
 * Plain-language notices when an official source could not be fully read on
 * the last check, or has not been checked recently. Internal error text is
 * never shown.
 */
export function sourceNotices(index: Pick<RestaurantIndex, 'sources'>, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (const [key, run] of Object.entries(index.sources ?? {})) {
    const agency = AGENCY[key] ?? key;
    const finished = new Date(run.finished_at);
    const days = Math.floor((now.getTime() - finished.getTime()) / 86_400_000);
    const on = Number.isNaN(finished.getTime())
      ? ''
      : ` on ${finished.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    if (run.status === 'failure') {
      out.push(`The last check of ${agency} records${on} failed, so recent inspections may be missing.`);
    } else if (run.status === 'partial') {
      out.push(`The last check of ${agency} records${on} could not read everything, so some recent inspections may be missing.`);
    } else if (days >= STALE_AFTER_DAYS) {
      out.push(`${agency} records were last checked${on}; newer inspections may not appear yet.`);
    }
  }
  return out;
}
