import { describe, expect, it } from 'vitest';
import { hitMatchesPlace, pointMatchesCity } from '../geo-trust';
import { lookupAddressPoint } from '../address-points';

const siouxFalls = new Set(['57105', '57106']);
const rapidCity = new Set(['57701', '57702']);

describe('ZIP-less location trust (R5)', () => {
  it('reproduces the collision: the point table answers by street alone', () => {
    const hit = lookupAddressPoint('2101 W 41ST ST', null);
    expect(hit).not.toBeNull();
    // the same call is what a Rapid City or Britton record would make
    expect(lookupAddressPoint('2101 W 41ST ST', null)).toEqual(hit);
  });

  it('accepts a point only in a ZIP on record for the requested city', () => {
    const hit = lookupAddressPoint('2101 W 41ST ST', null)!;
    expect(pointMatchesCity(hit.zip, new Set([hit.zip]))).toBe(true);
    expect(pointMatchesCity(hit.zip, rapidCity)).toBe(false);
    expect(pointMatchesCity(hit.zip, new Set())).toBe(false); // unknown city: cannot confirm
    expect(pointMatchesCity(null, siouxFalls)).toBe(false);
  });

  it('still honors an explicit ZIP exactly as before', () => {
    const hit = lookupAddressPoint('2101 W 41ST ST', null)!;
    expect(lookupAddressPoint('2101 W 41ST ST', hit.zip)).toEqual(hit);
    expect(lookupAddressPoint('2101 W 41ST ST', '57701')).toBeNull();
    expect(hitMatchesPlace({ city: 'Rapid City', zip5: '57701' }, { city: 'Sioux Falls', zip: '57701' }, new Set())).toBe(true);
    expect(hitMatchesPlace({ city: 'Rapid City', zip5: '57701' }, { city: 'Rapid City', zip: '57105' }, new Set())).toBe(false);
  });

  it('without a ZIP, a geocoder hit must be in the same city or one of its ZIPs', () => {
    const want = { city: 'Rapid City', zip5: null };
    expect(hitMatchesPlace(want, { city: 'Sioux Falls', zip: '57105' }, rapidCity)).toBe(false);
    expect(hitMatchesPlace(want, { city: 'rapid  city', zip: null }, rapidCity)).toBe(true);
    expect(hitMatchesPlace(want, { city: null, zip: '57702' }, rapidCity)).toBe(true);
    expect(hitMatchesPlace(want, { city: null, zip: null }, rapidCity)).toBe(false);
  });
});
