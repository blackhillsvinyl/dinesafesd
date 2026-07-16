import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { buildSearchIndex, searchRestaurants, normalize } from '../lib/search';
import { getScoreTheme } from '../scoring';
import TrendCue from '../components/TrendCue';
import type { Restaurant } from '../types';

type ScoreFilter = 'all' | '95' | '90' | 'below90';
type SortOrder = 'relevance' | 'best' | 'worst' | 'recent' | 'name';

const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: 'all', label: 'Any score' },
  { key: '95', label: '95+' },
  { key: '90', label: '90+' },
  { key: 'below90', label: 'Below 90' },
];

function matchesScore(r: Restaurant, f: ScoreFilter): boolean {
  if (f === 'all') return true;
  if (r.latest_score == null) return false;
  if (f === 'below90') return r.latest_score < 90;
  return r.latest_score >= Number(f);
}

const RECENT_DAYS = 365;

function isRecent(r: Restaurant): boolean {
  if (!r.latest_inspection_date) return false;
  return Date.now() - new Date(r.latest_inspection_date).getTime() < RECENT_DAYS * 86400_000;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [score, setScore] = useState<ScoreFilter>('all');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [sort, setSort] = useState<SortOrder>('relevance');

  const { data: index, isFetching } = useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
  });

  const searchIndex = useMemo(
    () => (index ? buildSearchIndex(index.restaurants) : []),
    [index]
  );

  // City dropdown options, biggest first
  const cities = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const r of index?.restaurants ?? []) {
      const name = (r.city ?? '').trim();
      if (!name || /\d/.test(name) || name.length > 30) continue;
      const key = name.toLowerCase();
      const c = counts.get(key);
      if (c) c.count++;
      else counts.set(key, { name, count: 1 });
    }
    return [...counts.values()].filter((c) => c.count >= 3).sort((a, b) => b.count - a.count);
  }, [index]);

  const hasQuery = normalize(query).length >= 2;
  const hasFilter = city !== '' || score !== 'all' || criticalOnly;

  const results = useMemo(() => {
    if (!index || (!hasQuery && !hasFilter)) return undefined;
    let list = hasQuery
      ? searchRestaurants(searchIndex, query, Infinity)
      : [...index.restaurants];
    if (city) list = list.filter((r) => (r.city ?? '').toLowerCase() === city);
    if (criticalOnly) list = list.filter((r) => r.has_critical_violations);
    list = list.filter((r) => matchesScore(r, score));
    const effectiveSort = sort === 'relevance' && !hasQuery ? 'best' : sort;
    if (effectiveSort === 'best') list.sort((a, b) => (b.latest_score ?? -1) - (a.latest_score ?? -1));
    else if (effectiveSort === 'worst') list.sort((a, b) => (a.latest_score ?? 101) - (b.latest_score ?? 101));
    else if (effectiveSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (effectiveSort === 'recent')
      list.sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''));
    return list.slice(0, 100);
  }, [index, searchIndex, query, hasQuery, hasFilter, city, score, criticalOnly, sort]);

  return (
    <div className="page">
      <h1>Search restaurants</h1>
      <input
        className="search-input"
        placeholder="Name, city, or address — e.g. “pizza ranch rapid city”"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="filter-row">
        <select className="filter-select" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c.name} value={c.name.toLowerCase()}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
        {SCORE_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-chip${score === f.key ? ' active' : ''}`}
            onClick={() => setScore(f.key)}
          >
            {f.label}
          </button>
        ))}
        <button
          className={`filter-chip${criticalOnly ? ' active' : ''}`}
          onClick={() => setCriticalOnly((v) => !v)}
        >
          ⚠ Critical violations
        </button>
        <select
          className="filter-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
          aria-label="Sort order"
        >
          <option value="relevance">Best match</option>
          <option value="best">Highest score</option>
          <option value="worst">Lowest score</option>
          <option value="recent">Recently inspected</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      <div className="result-list">
        {isFetching && !index && <p className="small">Loading…</p>}
        {results?.map((r) => {
          const theme = getScoreTheme(r.latest_score);
          return (
            <Link key={r.id} to={`/r/${r.id}`} className="result-card">
              <div className="result-info">
                <div className="result-name">{r.name}</div>
                <div className="result-addr">
                  {r.address}, {r.city}, {r.state}
                  {!isRecent(r) && r.latest_inspection_date && (
                    <span className="result-stale"> · last inspected {r.latest_inspection_date.slice(0, 4)}</span>
                  )}
                </div>
                <TrendCue
                  scoreHistory={r.score_history}
                  scoreTrend={r.score_trend}
                  violationHistory={r.violation_history}
                  violationTrend={r.violation_trend}
                />
              </div>
              <div className="score-pill" style={{ background: theme.markerColor }}>
                {r.latest_score ?? '—'}
              </div>
            </Link>
          );
        })}
        {results && results.length === 0 && <p className="small">No restaurants found.</p>}
        {results === undefined && !isFetching && (
          <p className="small">Type a name or city, or pick a filter to browse.</p>
        )}
      </div>
    </div>
  );
}
