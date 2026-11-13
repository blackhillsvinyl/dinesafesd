import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, rankRestaurants, searchRestaurants } from '../search';
import type { Restaurant } from '../../types';

const place = (name: string, city: string, latest_score: number | null, address = '1 MAIN ST'): Restaurant =>
  ({ id: `${name}-${city}`, name, city, address, state: 'SD', zip_code: null, latest_score }) as Restaurant;

// The case reported from the live site: typing "social" did not show
// THE SOCIAL HOUSE (Rapid City, score 85) until "the social" was typed.
const SOCIAL = [
  place('JACK ROSE SOCIAL CLUB STEEL', 'Sioux Falls', 96),
  place('THE W SOCIAL HOUSE', 'Vermillion', 95),
  place('UNION SOCIAL', 'Harrisburg', 95),
  place('JACK ROSE SOCIAL CLUB', 'Sioux Falls', 95),
  place('DEADWOOD SOCIAL CLUB', 'Deadwood', 87),
  place('THE SOCIAL HOUSE', 'Rapid City', 85),
  place('OAHE SOFTBALL ASSOCIATION', 'Pierre', 100),
];

describe('search ranking', () => {
  const index = buildSearchIndex(SOCIAL);
  const names = (q: string) => rankRestaurants(index, q).map((r) => r.name);

  it('does not rank by inspection score', () => {
    const top = names('social');
    // the name that starts with the query (ignoring "the") leads, then the shortest name
    expect(top.slice(0, 2)).toEqual(['THE SOCIAL HOUSE', 'UNION SOCIAL']);
    // identical data with the scores reversed gives the identical order
    const flipped = buildSearchIndex(SOCIAL.map((r) => ({ ...r, latest_score: 181 - (r.latest_score ?? 0) })));
    expect(rankRestaurants(flipped, 'social').map((r) => r.name)).toEqual(top);
  });

  it('finds every "social" restaurant and nothing else', () => {
    expect(names('social')).toHaveLength(6);
    expect(names('social')).not.toContain('OAHE SOFTBALL ASSOCIATION');
  });

  it('ignores a leading "the" when deciding what a name starts with', () => {
    expect(names('social house')[0]).toBe('THE SOCIAL HOUSE');
    expect(names('the social')[0]).toBe('THE SOCIAL HOUSE');
  });

  it('ranks a whole word above the start of a word above a fragment', () => {
    const idx = buildSearchIndex([
      place('ANTISOCIAL CLUB', 'Pierre', 99),
      place('SOCIALITE CAFE', 'Pierre', 99),
      place('THE SOCIAL', 'Pierre', 70),
    ]);
    expect(rankRestaurants(idx, 'social').map((r) => r.name)).toEqual(['THE SOCIAL', 'SOCIALITE CAFE', 'ANTISOCIAL CLUB']);
  });

  it('still tolerates a typo and matches across name and city', () => {
    expect(names('socail deadwood')).toEqual(['DEADWOOD SOCIAL CLUB']);
    expect(searchRestaurants(index, 'social', 3)).toHaveLength(3);
  });
});

describe('search on the published data', () => {
  const all: Restaurant[] = JSON.parse(
    readFileSync(new URL('../../../public/data/index.json', import.meta.url), 'utf8')
  ).restaurants;
  const index = buildSearchIndex(all);

  it('shows THE SOCIAL HOUSE within the first eight results for "social"', () => {
    const top = rankRestaurants(index, 'social').slice(0, 8).map((r) => `${r.name}, ${r.city}`);
    expect(top).toContain('THE SOCIAL HOUSE, Rapid City');
  });
});
