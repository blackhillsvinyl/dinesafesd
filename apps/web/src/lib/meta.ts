import { format, parseISO } from 'date-fns';
import type { Restaurant, RestaurantDetail } from '../types';
import { inspectionFindings } from './inspection';
import { officialSource } from './sources';
import { isVerifiedLocation } from './geo';

// Titles, descriptions and canonical URLs — one definition used by both the
// running app (usePageMeta) and the build-time prerender (scripts/prerender.tsx).

export const SITE_ORIGIN = 'https://dinesafesd.com';
export const SITE_NAME = 'DineSafeSD';
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/icon-512.png`;

export interface PageMeta {
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. "/r/abc". */
  path: string;
  noindex?: boolean;
}

export const HOME_INTRO =
  'South Dakota restaurant health inspections. Search official scores, violations, and inspection history. Free—no account needed.';

export const STATIC_META: Record<string, PageMeta> = {
  '/': {
    title: 'DineSafeSD — South Dakota Restaurant Health Inspections',
    description: HOME_INTRO,
    path: '/',
  },
  '/search': {
    title: 'Search South Dakota restaurant inspections | DineSafeSD',
    description:
      'Search South Dakota restaurants by name, city, ZIP, or address and see official health inspection scores and violations.',
    path: '/search',
  },
  '/latest': {
    title: 'Latest South Dakota restaurant inspection reports | DineSafeSD',
    description:
      'The most recent restaurant health inspection reports published by the South Dakota Department of Health and the City of Sioux Falls.',
    path: '/latest',
  },
  '/about': {
    title: 'About DineSafeSD — data sources, coverage, and score guide',
    description:
      'Where DineSafeSD inspection data comes from, what it covers, its known gaps, and how scores and severity labels are shown.',
    path: '/about',
  },
  '/privacy': {
    title: 'Privacy Policy | DineSafeSD',
    description: 'DineSafeSD has no accounts, analytics, advertising, or tracking. Saved restaurants stay on your device.',
    path: '/privacy',
  },
  '/terms': {
    title: 'Terms of Use | DineSafeSD',
    description: 'Terms of use for DineSafeSD, a free viewer for public South Dakota restaurant inspection records.',
    path: '/terms',
  },
  '/support': {
    title: 'Support | DineSafeSD',
    description: 'Get help with DineSafeSD or report a data or map problem.',
    path: '/support',
  },
};

export const NOT_FOUND_META: PageMeta = {
  title: 'Page not found | DineSafeSD',
  description: 'This page does not exist on DineSafeSD.',
  path: '/',
  noindex: true,
};

export function restaurantPath(id: string): string {
  return `/r/${encodeURIComponent(id)}`;
}

export function longDate(iso: string): string {
  return format(parseISO(iso), 'MMMM d, yyyy');
}

export function restaurantMeta(r: RestaurantDetail): PageMeta {
  const where = `${r.city}, ${r.state}`;
  const agency = officialSource(r).agency;
  const latest = r.inspections[0];
  const parts: string[] = [];
  if (latest) {
    const f = inspectionFindings(latest, r.source);
    const bits = [`Latest inspection ${longDate(latest.date)}`];
    if (latest.score != null) bits.push(`score ${latest.score} out of 100`);
    if (f.kind === 'itemized' || f.kind === 'count-only') {
      const n = f.kind === 'itemized' && f.listed !== null ? f.listed : f.count;
      bits.push(`${n} violation${n === 1 ? '' : 's'} recorded`);
    } else if (f.kind === 'none-recorded') {
      bits.push('no violations recorded');
    }
    parts.push(bits.join(', ') + '.');
  } else {
    parts.push('No inspections on record yet.');
  }
  parts.push(`Inspection history for ${r.name}, ${r.address}, ${where}, from the ${agency}.`);
  return {
    title: `${r.name} — ${where} health inspections | ${SITE_NAME}`,
    description: parts.join(' '),
    path: restaurantPath(r.id),
  };
}

/**
 * Structured data limited to what the page actually states: a web page about
 * a named business at an address. Inspection scores are deliberately not
 * expressed as ratings or reviews — they are neither.
 */
export function restaurantJsonLd(r: RestaurantDetail, meta: PageMeta): Record<string, unknown> {
  const business: Record<string, unknown> = {
    '@type': 'LocalBusiness',
    name: r.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: r.address,
      addressLocality: r.city,
      addressRegion: r.state,
      ...(r.zip_code ? { postalCode: r.zip_code } : {}),
      addressCountry: 'US',
    },
  };
  if (r.phone) business.telephone = r.phone;
  if (isVerifiedLocation(r as Restaurant)) {
    business.geo = { '@type': 'GeoCoordinates', latitude: r.latitude, longitude: r.longitude };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: SITE_ORIGIN + meta.path,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_ORIGIN + '/' },
    ...(r.latest_inspection_date ? { dateModified: r.latest_inspection_date } : {}),
    about: business,
  };
}
