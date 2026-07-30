import type { Restaurant } from '../types';

// "Wrong location" reports carry everything needed to reproduce and fix —
// record id, address, current pin. support@ forwards privately.
const REPORT_TO = 'support@dinesafesd.com';

export function locationReportMailto(
  r: Pick<Restaurant, 'id' | 'name' | 'address' | 'city' | 'latitude' | 'longitude'>
): string {
  const subject = `DineSafeSD wrong location: ${r.name}`;
  const body = [
    `Restaurant: ${r.name}`,
    `Address: ${r.address}, ${r.city}, SD`,
    `Record: ${r.id}`,
    `Current pin: ${r.latitude?.toFixed(6)}, ${r.longitude?.toFixed(6)}`,
    '',
    'Where should it be? (an address, cross-street, or map link helps):',
    '',
  ].join('\n');
  return `mailto:${REPORT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
