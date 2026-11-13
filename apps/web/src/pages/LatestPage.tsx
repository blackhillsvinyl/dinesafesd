import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fetchIndex } from '../lib/api';
import { buildCityOptions, inCity } from '../lib/search';
import { useSavedVersion } from '../lib/saved';
import ResultCard from '../components/ResultCard';
import type { Restaurant } from '../types';

const FEED_SIZE = 150;

/** Stream of the most recent inspection reports, newest day first, optionally for one city. */
export default function LatestPage() {
  const { data: index, isFetching } = useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
  });
  const [params, setParams] = useSearchParams();
  const city = (params.get('city') ?? '').toLowerCase();

  useSavedVersion();

  // Long feed on a phone needs a way back up
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const cities = useMemo(() => buildCityOptions(index?.restaurants ?? [], 1), [index]);
  const cityName = cities.find((c) => c.key === city)?.name ?? null;

  const { days, total } = useMemo(() => {
    if (!index) return { days: [], total: 0 };
    const dated = index.restaurants.filter(
      (r) => r.latest_inspection_date && (!city || inCity(r, city))
    );
    dated.sort((a, b) =>
      (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? '')
    );
    const grouped: Array<{ date: string; items: Restaurant[] }> = [];
    for (const r of dated.slice(0, FEED_SIZE)) {
      const d = r.latest_inspection_date!;
      const g = grouped[grouped.length - 1];
      if (g && g.date === d) g.items.push(r);
      else grouped.push({ date: d, items: [r] });
    }
    return { days: grouped, total: dated.length };
  }, [index, city]);

  const shown = Math.min(total, FEED_SIZE);
  const where = cityName ? ` in ${cityName}` : ' across South Dakota';

  return (
    <div className="page">
      <h1>Latest reports</h1>
      <p className="page-lede">
        The most recent health-inspection results, grouped by the date of the inspection, newest
        first.
        {index && (
          <> DineSafeSD last refreshed its data on {format(new Date(index.updated_at), 'MMMM d, yyyy')}.</>
        )}
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field-label">City</span>
          <select
            className="filter-select"
            value={cityName ? city : ''}
            onChange={(e) => {
              const value = e.target.value;
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (value) next.set('city', value);
                  else next.delete('city');
                  return next;
                },
                { replace: true }
              );
            }}
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </label>
        {cityName && (
          <button
            type="button"
            className="filter-chip"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('city');
              setParams(next, { replace: true });
            }}
          >
            Show all cities
          </button>
        )}
      </div>

      <p className="result-count" role="status">
        {isFetching && !index
          ? 'Loading…'
          : index
            ? total > shown
              ? `Showing the ${shown} most recent of ${total.toLocaleString()} restaurants${where}.`
              : `${shown} restaurant${shown === 1 ? '' : 's'}${where}.`
            : ''}
      </p>

      {index && city && !cityName && (
        <div className="empty-state">
          <p>We don’t have a city called “{params.get('city')}”.</p>
          <button
            type="button"
            className="filter-chip"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Show all cities
          </button>
        </div>
      )}

      {days.map((day) => (
        <section key={day.date}>
          <h2 className="feed-day">Inspected {format(parseISO(day.date), 'EEEE, MMMM d, yyyy')}</h2>
          <div className="result-list">
            {day.items.map((r) => (
              <ResultCard key={r.id} restaurant={r} chips />
            ))}
          </div>
        </section>
      ))}
      {showTop && (
        <button
          type="button"
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <span aria-hidden="true">↑ </span>Back to top
        </button>
      )}
    </div>
  );
}
