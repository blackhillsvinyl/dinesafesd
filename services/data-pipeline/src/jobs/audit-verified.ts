/**
 * Statewide audit of EVERY verified record: re-derive placement from
 * authoritative evidence and snap/demote whatever disagrees — regardless of
 * which tier originally placed it. Authority beats provenance.
 *
 *   1. Government rooftop address point for the record's own address
 *      (fixed candidateKeys matching, ZIP-checked; ZIP-less entries are
 *      gated by settlement distance): if it sits >250 m from the current
 *      pin, SNAP the record to the rooftop point.
 *   2. Otherwise an OSM POI whose tagged address matches: >250 m away →
 *      snap to the POI.
 *   3. No evidence → leave as-is (it passed anchor gates when placed).
 *
 * Usage: npm run audit:verified   (in services/data-pipeline)
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../lib/store.js';
import { normalizeStreet } from '../lib/address.js';
import { candidateKeys, parseStreetParts } from '../lib/address-points.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, '../../../../apps/web/public/data');
const POINTS_FILE = path.resolve(moduleDir, '../data/address-points-sd.json.gz');
const POI_FILE = path.resolve(moduleDir, '../data/osm-pois-sd.json.gz');

const SNAP_KM = 0.25; // agree within this → leave alone
// ZIP-less evidence can only REFINE a placement locally — street names like
// "Main St" exist in every town, so without a ZIP pinning the town, evidence
// further than this from the current pin is ambiguous and must be ignored.
const LOCAL_KM = 2;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * 111, (aLng - bLng) * 79);
}

const NOISE = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'CIR', 'LN', 'CT', 'PL', 'HWY', 'WAY',
  'TRL', 'PKWY', 'TER', 'SQ', 'LOOP', 'STREET', 'AVENUE', 'DRIVE', 'ROAD',
]);
function significantTokens(street: string): string[] {
  return street
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t));
}

const pointDb = (
  JSON.parse(gunzipSync(readFileSync(POINTS_FILE)).toString('utf8')) as {
    entries: Record<string, [number, number, number | string]>;
  }
).entries;

interface Poi {
  name: string | null;
  lat: number;
  lng: number;
  street?: string | null;
  num?: string | null;
}
interface Place { name: string | null; rank: string; lat: number; lng: number }

function main() {
  const index = JSON.parse(readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const restaurants: Array<Record<string, unknown>> = index.restaurants;

  const osm = JSON.parse(gunzipSync(readFileSync(POI_FILE)).toString('utf8')) as {
    pois: Poi[];
    places: Place[];
  };
  const poisWithAddr = osm.pois.filter((p) => p.num && p.street);
  const PLACE_RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };
  const placesByName = new Map<string, Place[]>();
  for (const p of osm.places) {
    if (!p.name) continue;
    const n = p.name.toLowerCase();
    if (!placesByName.has(n)) placesByName.set(n, []);
    placesByName.get(n)!.push(p);
  }
  function placeAnchor(city: string): { lat: number; lng: number } | null {
    const candidates = placesByName.get(city.toLowerCase());
    if (!candidates?.length) return null;
    const pick = [...candidates].sort(
      (a, b) => (PLACE_RANK[a.rank] ?? 9) - (PLACE_RANK[b.rank] ?? 9)
    )[0];
    return { lat: pick.lat, lng: pick.lng };
  }

  const ver = restaurants.filter(
    (r) => r.geo_precision === 'rooftop' || r.geo_precision === 'address'
  );

  let snapped = 0;
  let agreed = 0;
  let noEvidence = 0;
  const moves: Array<[string, string, number]> = [];

  for (const r of ver) {
    const city = String(r.city ?? '').trim();
    const zip = (r.zip_code as string) || null;
    const norm = normalizeStreet(String(r.address ?? ''));
    const curLat = Number(r.latitude);
    const curLng = Number(r.longitude);
    const anchor = placeAnchor(city);
    // ZIP-agreeing evidence is pinned to the right town and may move the
    // record any distance (sanity: near the settlement when we know it);
    // ZIP-less evidence may only refine locally.
    const zipOk = (lat: number, lng: number) =>
      !anchor || kmBetween(lat, lng, anchor.lat, anchor.lng) <= 60;
    const localOk = (lat: number, lng: number) =>
      kmBetween(lat, lng, curLat, curLng) <= LOCAL_KM;

    // Evidence 1: rooftop address point (strict zip first, then zip-less)
    let ev: { lat: number; lng: number; precision: 'rooftop' | 'address' } | null = null;
    for (const key of candidateKeys(norm.street)) {
      const hit = pointDb[key];
      if (!hit) continue;
      const [lat, lng, hitZip] = hit;
      const z = String(hitZip);
      if (zip && z) {
        if (z !== String(zip)) continue;
        if (!zipOk(lat, lng)) continue;
      } else if (!localOk(lat, lng)) {
        continue;
      }
      ev = { lat, lng, precision: 'rooftop' };
      break;
    }

    // Evidence 1b: address is missing its cardinal — try N/S/E/W variants;
    // accept only when the surviving variants agree on one spot
    if (!ev) {
      const parts = parseStreetParts(norm.street);
      if (parts && parts.predir === '') {
        const rest = norm.street.replace(/^\s*\S+\s*/, '');
        const hits: Array<{ lat: number; lng: number }> = [];
        for (const dvar of ['N', 'S', 'E', 'W']) {
          for (const key of candidateKeys(`${parts.num} ${dvar} ${rest}`)) {
            const hit = pointDb[key];
            if (!hit) continue;
            const [lat, lng, hitZip] = hit;
            const z = String(hitZip);
            if (zip && z) {
              if (z !== String(zip)) continue;
              if (!zipOk(lat, lng)) continue;
            } else if (!localOk(lat, lng)) {
              continue;
            }
            hits.push({ lat, lng });
            break;
          }
        }
        if (
          hits.length &&
          hits.every((h) => kmBetween(h.lat, h.lng, hits[0].lat, hits[0].lng) < 0.3)
        ) {
          ev = { lat: hits[0].lat, lng: hits[0].lng, precision: 'rooftop' };
        }
      }
    }

    // Evidence 2: OSM POI with matching tagged address
    if (!ev) {
      const wantParts = parseStreetParts(norm.street);
      const wantTokens = significantTokens(norm.street.replace(/^\d+\s*/, ''));
      if (wantParts && wantTokens.length) {
        const matches = poisWithAddr.filter((p) => {
          if (String(p.num).toUpperCase() !== wantParts.num) return false;
          const poiTokens = significantTokens(String(p.street));
          if (!poiTokens.some((t) => wantTokens.includes(t))) return false;
          return localOk(p.lat, p.lng);
        });
        if (
          matches.length &&
          matches.every((p) => kmBetween(p.lat, p.lng, matches[0].lat, matches[0].lng) < 0.3)
        ) {
          ev = { lat: matches[0].lat, lng: matches[0].lng, precision: 'address' };
        }
      }
    }

    if (!ev) {
      noEvidence++;
      continue;
    }
    const dist = kmBetween(ev.lat, ev.lng, curLat, curLng);
    if (dist <= SNAP_KM) {
      agreed++;
      continue;
    }
    moves.push([String(r.name), `${r.address}, ${city}`, dist]);
    store.upsertRestaurant({
      external_id: String(r.id),
      name: String(r.name),
      address: String(r.address),
      city,
      state: 'SD',
      zip_code: zip,
      phone: (r.phone as string) ?? null,
      latitude: ev.lat,
      longitude: ev.lng,
      source: String(r.source),
      geo_precision: ev.precision,
      source_address: (r.source_address as string) ?? null,
    });
    snapped++;
  }

  const { restaurantsWritten } = store.save();
  moves.sort((a, b) => b[2] - a[2]);
  for (const [name, addr, dist] of moves.slice(0, 40)) {
    console.log(`snap ${dist.toFixed(2).padStart(7)}km  ${name.slice(0, 34).padEnd(36)} ${addr.slice(0, 44)}`);
  }
  console.log(
    `verified audited: ${ver.length}   agreed: ${agreed}   snapped: ${snapped}   no independent evidence: ${noEvidence}   written: ${restaurantsWritten}`
  );
}

main();
