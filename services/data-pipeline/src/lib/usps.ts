/**
 * USPS address standardization — the validation backbone of the geocode
 * pipeline. Every address is standardized to canonical USPS form before any
 * coordinate lookup, and coordinate sources must agree with the USPS street
 * and ZIP to be trusted. (USPS itself publishes no coordinates.)
 *
 * Credentials: env vars USPS_CLIENT_ID/USPS_CLIENT_SECRET (or USPS_USERID for
 * legacy Web Tools), else ~/.config/safeeats/usps-credentials with the same
 * KEY=value lines. Results are cached in the store (usps-cache.json) so each
 * unique address is validated once.
 */

import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { store } from './store.js';

export interface UspsAddress {
  street: string; // canonical street line, e.g. "1835 HARMONY HEIGHTS LN"
  city: string; // canonical post city
  zip5: string;
  zip4: string | null;
}

interface Creds {
  kind: 'oauth' | 'webtools';
  clientId?: string;
  clientSecret?: string;
  userId?: string;
}

let creds: Creds | null | undefined;

function loadCreds(): Creds | null {
  if (creds !== undefined) return creds;
  const env = process.env;
  let raw: Record<string, string> = {};
  if (env.USPS_CLIENT_ID || env.USPS_USERID) {
    raw = {
      CLIENT_ID: env.USPS_CLIENT_ID ?? '',
      CLIENT_SECRET: env.USPS_CLIENT_SECRET ?? '',
      USERID: env.USPS_USERID ?? '',
    };
  } else {
    const file = path.join(os.homedir(), '.config/safeeats/usps-credentials');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) raw[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
      }
    }
  }
  if (raw.CLIENT_ID && raw.CLIENT_SECRET) {
    creds = { kind: 'oauth', clientId: raw.CLIENT_ID, clientSecret: raw.CLIENT_SECRET };
  } else if (raw.USERID) {
    creds = { kind: 'webtools', userId: raw.USERID };
  } else {
    creds = null;
  }
  return creds;
}

export function uspsAvailable(): boolean {
  return loadCreds() !== null;
}

let oauthToken: { token: string; expires: number } | null = null;

async function getOauthToken(c: Creds): Promise<string> {
  if (oauthToken && Date.now() < oauthToken.expires - 60_000) return oauthToken.token;
  const resp = await fetch('https://apis.usps.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  });
  if (!resp.ok) throw new Error(`USPS OAuth failed: HTTP ${resp.status} ${await resp.text()}`);
  const j = (await resp.json()) as { access_token: string; expires_in: number };
  oauthToken = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return oauthToken.token;
}

async function standardizeOauth(
  c: Creds,
  street: string,
  city: string,
  zip: string | null
): Promise<UspsAddress | null> {
  const token = await getOauthToken(c);
  const p = new URLSearchParams({ streetAddress: street, state: 'SD' });
  if (city) p.set('city', city);
  if (zip) p.set('ZIPCode', zip);
  const resp = await fetch(`https://apis.usps.com/addresses/v3/address?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404 || resp.status === 400) return null; // not a deliverable/known address
  if (!resp.ok) throw new Error(`USPS address API: HTTP ${resp.status} ${await resp.text()}`);
  const j = (await resp.json()) as {
    address?: { streetAddress?: string; city?: string; ZIPCode?: string; ZIPPlus4?: string };
  };
  const a = j.address;
  if (!a?.streetAddress || !a.ZIPCode) return null;
  return {
    street: a.streetAddress.toUpperCase(),
    city: (a.city ?? city).toUpperCase(),
    zip5: a.ZIPCode,
    zip4: a.ZIPPlus4 ?? null,
  };
}

async function standardizeWebtools(
  c: Creds,
  street: string,
  city: string,
  zip: string | null
): Promise<UspsAddress | null> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = `<AddressValidateRequest USERID="${esc(c.userId!)}"><Revision>1</Revision><Address ID="0"><Address1/><Address2>${esc(street)}</Address2><City>${esc(city)}</City><State>SD</State><Zip5>${esc(zip ?? '')}</Zip5><Zip4/></Address></AddressValidateRequest>`;
  const resp = await fetch(
    `https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=${encodeURIComponent(xml)}`
  );
  if (!resp.ok) throw new Error(`USPS Web Tools: HTTP ${resp.status}`);
  const body = await resp.text();
  if (/<Error>/i.test(body)) return null;
  const get = (tag: string) => body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1] ?? '';
  const outStreet = get('Address2');
  const zip5 = get('Zip5');
  if (!outStreet || !zip5) return null;
  return {
    street: outStreet.toUpperCase(),
    city: (get('City') || city).toUpperCase(),
    zip5,
    zip4: get('Zip4') || null,
  };
}

/**
 * Standardize an address to canonical USPS form. Returns null when USPS does
 * not recognize the address (reported in the audit as unknown-to-USPS).
 * Throws if credentials are missing/invalid — the pipeline treats USPS as
 * required, not optional.
 */
export async function standardizeAddress(
  street: string,
  city: string,
  zip: string | null
): Promise<UspsAddress | null> {
  const c = loadCreds();
  if (!c) throw new Error('USPS credentials not configured (env or ~/.config/safeeats/usps-credentials)');

  const cacheKey = `${street}|${city}|${zip ?? ''}`.toUpperCase();
  const cached = store.getCachedUsps<UspsAddress>(cacheKey);
  if (cached !== undefined) return cached;

  const result =
    c.kind === 'oauth'
      ? await standardizeOauth(c, street, city, zip)
      : await standardizeWebtools(c, street, city, zip);
  store.setCachedUsps(cacheKey, result);
  return result;
}
