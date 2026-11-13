import type { Restaurant } from '../types';

// Official record locations. SWEEPS detail pages are plain GET URLs keyed by
// the site id we already store, so they can be deep linked. The SD DOH portal
// is an ASP.NET WebForms search (results only via postback), so the best we
// can do there is open its public search page and hand over the exact name.

export const SWEEPS_HOME = 'https://sweepsdata.siouxfalls.gov/';
// Every establishment on the SWEEPS list uses this facility type (the same
// value the pipeline follows in sync-sioux-falls.ts).
const SWEEPS_FAC_TYPE = '16F';
// The portal root is a licensee login page; this is the public search.
export const SD_DOH_SEARCH =
  'https://sddoh.safefoodinspection.com/Inspection/publicinspectionsearch.aspx';

export interface OfficialSource {
  agency: string;
  portalName: string;
  url: string;
  /** True when url opens this establishment's own record. */
  deepLink: boolean;
}

export function officialSource(r: Pick<Restaurant, 'id' | 'source'>): OfficialSource {
  if (r.source === 'sf_sweeps') {
    const siteId = /^sf_sweeps_(\d+)$/.exec(r.id)?.[1];
    return {
      agency: 'City of Sioux Falls Health Department',
      portalName: 'Sioux Falls SWEEPS database',
      url: siteId
        ? `${SWEEPS_HOME}Restaurant_Detail.aspx?SiteID=${siteId}&FacType=${SWEEPS_FAC_TYPE}&inv=1`
        : SWEEPS_HOME,
      deepLink: !!siteId,
    };
  }
  return {
    agency: 'South Dakota Department of Health',
    portalName: 'SD DOH public inspection search',
    url: SD_DOH_SEARCH,
    deepLink: false,
  };
}
