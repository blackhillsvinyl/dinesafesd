import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { buildCityOptions, buildSearchIndex, inCity, searchRestaurants, normalize } from '../lib/search';
import ResultCard from '../components/ResultCard';
import { CRITICAL_FILTER_NOTE } from '../lib/inspection';
import LoadError, { SourceNotices } from '../components/LoadError';
import { sourceNotices } from '../lib/sourceHealth';
import {
  isFavorite,
  isWatched,
  favoriteCount,
  watchCount,
  useSavedVersion,
} from '../lib/saved';
import type { Restaurant } from '../types';

type ScoreFilter = 'all' | '95' | '90' | 'below90';
type SortOrder = 'relevance' | 'best' | 'worst' | 'recent' | 'name';
type SavedFilter = 'none' | 'favorites' | 'watching';

const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: 'all', label: 'Any score' },
  { key: '95', label: '95+' },
  { key: '90', label: '90+' },
  { key: 'below90', label: 'Below 90' },
];
const SCORE_LABEL: Record<ScoreFilter, string> = {
  all: 'Any score',
  '95': 'Score 95+',
  '90': 'Score 90+',
  below90: 'Score below 90',
};

const RESULT_LIMIT = 100;

function matchesScore(r: Restaurant, f: ScoreFilter): boolean {
  if (f === 'all') return true;
  if (r.latest_score == null) return false;
  if (f === 'below90') return r.latest_score < 90;
  return r.latest_score >= Number(f);
}

export default function SearchPage() {
  // The query and city live in the URL so Back from a report restores them
  const [params, setParams] = useSearchParams();
  const city = (params.get('city') ?? '').toLowerCase();
  type ParamKey = 'q' | 'city' | 'score' | 'critical' | 'saved' | 'sort';
  const setParam = (key: ParamKey, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  };
  // The text box owns its value (a URL-bound input drops fast keystrokes);
  // the URL follows it.
  const [query, setQueryState] = useState(() => params.get('q') ?? '');
  const setQuery = (value: string) => {
    setQueryState(value);
    setParam('q', value.trim());
  };

  // Every filter and the sort order live in the URL, so Back from a report
  // and a refresh restore exactly what was selected.
  const scoreParam = params.get('score');
  const score: ScoreFilter = scoreParam === '95' || scoreParam === '90' || scoreParam === 'below90' ? scoreParam : 'all';
  const setScore = (v: ScoreFilter) => setParam('score', v === 'all' ? '' : v);
  const criticalOnly = params.get('critical') === '1';
  const setCriticalOnly = (v: boolean) => setParam('critical', v ? '1' : '');
  const savedParam = params.get('saved');
  const savedOnly: SavedFilter = savedParam === 'favorites' || savedParam === 'watching' ? savedParam : 'none';
  const setSavedOnly = (v: SavedFilter) => setParam('saved', v === 'none' ? '' : v);
  const sortParam = params.get('sort');
  const sort: SortOrder =
    sortParam === 'best' || sortParam === 'worst' || sortParam === 'recent' || sortParam === 'name' ? sortParam : 'relevance';
  const setSort = (v: SortOrder) => setParam('sort', v === 'relevance' ? '' : v);
  const [moreOpen, setMoreOpen] = useState(false);
  const savedVersion = useSavedVersion();

  const { data: index, isFetching, isError, refetch } = useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
  });

  const searchIndex = useMemo(
    () => (index ? buildSearchIndex(index.restaurants) : []),
    [index]
  );
  const cities = useMemo(() => buildCityOptions(index?.restaurants ?? []), [index]);
  const cityName = cities.find((c) => c.key === city)?.name ?? (city ? params.get('city') : null);

  const hasQuery = normalize(query).length >= 2;
  const secondaryCount =
    (score !== 'all' ? 1 : 0) + (criticalOnly ? 1 : 0) + (savedOnly !== 'none' ? 1 : 0);
  const hasFilter = city !== '' || secondaryCount > 0;

  const clearParams = (keys: ParamKey[]) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of keys) next.delete(k);
        return next;
      },
      { replace: true }
    );
  const clearSecondary = () => clearParams(['score', 'critical', 'saved']);
  const clearFilters = () => clearParams(['score', 'critical', 'saved', 'city']);

  const { results, total } = useMemo(() => {
    if (!index || (!hasQuery && !hasFilter)) return { results: undefined, total: 0 };
    let list = hasQuery
      ? searchRestaurants(searchIndex, query, Infinity)
      : [...index.restaurants];
    if (city) list = list.filter((r) => inCity(r, city));
    if (criticalOnly) list = list.filter((r) => r.has_critical_violations);
    if (savedOnly === 'favorites') list = list.filter((r) => isFavorite(r.id));
    if (savedOnly === 'watching') list = list.filter((r) => isWatched(r.id));
    list = list.filter((r) => matchesScore(r, score));
    const effectiveSort = sort === 'relevance' && !hasQuery ? 'best' : sort;
    if (effectiveSort === 'best') list.sort((a, b) => (b.latest_score ?? -1) - (a.latest_score ?? -1));
    else if (effectiveSort === 'worst') list.sort((a, b) => (a.latest_score ?? 101) - (b.latest_score ?? 101));
    else if (effectiveSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (effectiveSort === 'recent')
      list.sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''));
    return { results: list.slice(0, RESULT_LIMIT), total: list.length };
    // savedVersion re-filters when hearts/watches change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, searchIndex, query, hasQuery, hasFilter, city, score, criticalOnly, savedOnly, sort, savedVersion]);

  // Active selections stay visible (and removable) even with "More filters" closed
  const active: { label: string; remove: () => void }[] = [];
  if (city) active.push({ label: `City: ${cityName}`, remove: () => setParam('city', '') });
  if (score !== 'all') active.push({ label: SCORE_LABEL[score], remove: () => setScore('all') });
  if (criticalOnly)
    active.push({ label: 'Critical violations on latest inspection', remove: () => setCriticalOnly(false) });
  if (savedOnly !== 'none')
    active.push({
      label: savedOnly === 'favorites' ? 'Favorites' : 'Watching',
      remove: () => setSavedOnly('none'),
    });

  const countText = !index
    ? isFetching
      ? 'Loading…'
      : ''
    : results === undefined
      ? ''
      : total === 0
        ? 'No restaurants match.'
        : total > RESULT_LIMIT
          ? `Showing the first ${RESULT_LIMIT} of ${total.toLocaleString()} restaurants. Add a word or a filter to narrow.`
          : `${total} restaurant${total === 1 ? '' : 's'} found.`;

  const emptySaved =
    savedOnly === 'favorites' ? favoriteCount() === 0 : savedOnly === 'watching' ? watchCount() === 0 : false;

  return (
    <div className="page">
      <h1>Search restaurants</h1>
      <div className="search-primary">
        <label className="field field-grow">
          <span className="field-label">Name, address, or ZIP</span>
          <input
            className="search-input"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="e.g. pizza ranch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">City</span>
          <select
            className="filter-select"
            value={cities.some((c) => c.key === city) ? city : ''}
            onChange={(e) => setParam('city', e.target.value)}
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="filter-row">
        <button
          type="button"
          className={`filter-chip${moreOpen ? ' open' : ''}`}
          aria-expanded={moreOpen}
          aria-controls="more-filters"
          onClick={() => setMoreOpen((v) => !v)}
        >
          More filters{secondaryCount ? ` (${secondaryCount})` : ''}
        </button>
        <label className="field field-inline">
          <span className="field-label">Sort</span>
          <select
            className="filter-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
          >
            <option value="relevance">Best match</option>
            <option value="best">Highest score</option>
            <option value="worst">Lowest score</option>
            <option value="recent">Recently inspected</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      {moreOpen && (
        <div className="more-filters" id="more-filters">
          <div role="group" aria-labelledby="sf-score">
            <div className="mf-label" id="sf-score">Latest score</div>
            <div className="mf-chips">
              {SCORE_FILTERS.map((f) => (
                <button
                  type="button"
                  key={f.key}
                  className={`filter-chip${score === f.key ? ' active' : ''}`}
                  aria-pressed={score === f.key}
                  onClick={() => setScore(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-labelledby="sf-insp">
            <div className="mf-label" id="sf-insp">Latest inspection</div>
            <div className="mf-chips">
              <button
                type="button"
                className={`filter-chip${criticalOnly ? ' active' : ''}`}
                aria-pressed={criticalOnly}
                onClick={() => setCriticalOnly(!criticalOnly)}
              >
                <span aria-hidden="true">⚠</span>Critical violations
              </button>
            </div>
            <p className="legend-note">{CRITICAL_FILTER_NOTE}</p>
          </div>
          <div role="group" aria-labelledby="sf-saved">
            <div className="mf-label" id="sf-saved">Saved on this device</div>
            <div className="mf-chips">
              <button
                type="button"
                className={`filter-chip${savedOnly === 'favorites' ? ' active' : ''}`}
                aria-pressed={savedOnly === 'favorites'}
                onClick={() => setSavedOnly(savedOnly === 'favorites' ? 'none' : 'favorites')}
              >
                <span aria-hidden="true">♥</span>Favorites{favoriteCount() > 0 ? ` (${favoriteCount()})` : ''}
              </button>
              <button
                type="button"
                className={`filter-chip${savedOnly === 'watching' ? ' active' : ''}`}
                aria-pressed={savedOnly === 'watching'}
                onClick={() => setSavedOnly(savedOnly === 'watching' ? 'none' : 'watching')}
              >
                Watching{watchCount() > 0 ? ` (${watchCount()})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="active-filters" role="group" aria-label="Active filters">
          {active.map((a) => (
            <button type="button" key={a.label} className="filter-chip active removable" onClick={a.remove}>
              <span className="sr-only">Remove filter: </span>
              {a.label}
              <span aria-hidden="true"> ✕</span>
            </button>
          ))}
          {active.length > 1 && (
            <button type="button" className="link-btn" onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </div>
      )}

      {index && <SourceNotices notices={sourceNotices(index)} />}
      {isError && !index && (
        <LoadError what="the restaurant list" onRetry={() => refetch()} busy={isFetching} />
      )}

      <p className="result-count" role="status">
        {countText}
      </p>

      <div className="result-list">
        {results?.map((r) => <ResultCard key={r.id} restaurant={r} date />)}
      </div>

      {results && results.length === 0 && (
        <div className="empty-state">
          <p className="empty-title">
            No restaurants match
            {hasQuery ? <> “{query.trim()}”</> : null}
            {active.length > 0 ? <> with {active.map((a) => a.label).join(', ')}</> : null}.
          </p>
          {emptySaved ? (
            <p>
              You haven’t {savedOnly === 'favorites' ? 'saved any favorites' : 'watched any restaurants'}{' '}
              on this device yet. Use Save or Watch on a restaurant to add one.
            </p>
          ) : (
            <p>
              {hasQuery
                ? 'Check the spelling, try fewer words, or search by city or ZIP instead.'
                : 'Try removing a filter.'}
            </p>
          )}
          <div className="empty-actions">
            {city && hasQuery && (
              <button type="button" className="filter-chip" onClick={() => setParam('city', '')}>
                Search all cities
              </button>
            )}
            {secondaryCount > 0 && (
              <button type="button" className="filter-chip" onClick={clearSecondary}>
                Clear {city ? 'other ' : ''}filters
              </button>
            )}
            {hasQuery && hasFilter && (
              <button type="button" className="filter-chip" onClick={() => setQuery('')}>
                Clear search text
              </button>
            )}
            <Link className="filter-chip" to="/">
              Browse the map
            </Link>
          </div>
        </div>
      )}

      {results === undefined && index && (
        <p className="page-lede">Type a name, pick a city, or open More filters to browse.</p>
      )}
    </div>
  );
}
