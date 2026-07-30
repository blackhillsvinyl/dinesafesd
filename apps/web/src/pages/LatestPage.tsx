import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fetchIndex } from '../lib/api';
import { getScoreTheme } from '../scoring';
import { categoryVisual } from '../violationCategories';
import type { Restaurant } from '../types';

const FEED_SIZE = 150;

/** Stream of the most recent inspection reports, newest day first. */
export default function LatestPage() {
  const { data: index, isFetching } = useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
  });

  const days = useMemo(() => {
    if (!index) return [];
    const dated = index.restaurants.filter((r) => r.latest_inspection_date);
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
    return grouped;
  }, [index]);

  return (
    <div className="page">
      <h1>Latest reports</h1>
      <p className="small">
        The most recent health-inspection results across South Dakota, newest first.
      </p>
      {isFetching && !index && <p className="small">Loading…</p>}
      {days.map((day) => (
        <section key={day.date}>
          <div className="feed-day">{format(parseISO(day.date), 'EEEE, MMMM d, yyyy')}</div>
          <div className="result-list">
            {day.items.map((r) => {
              const theme = getScoreTheme(r.latest_score);
              return (
                <Link key={r.id} to={`/r/${r.id}`} className="result-card">
                  <div className="result-info">
                    <div className="result-name">{r.name}</div>
                    <div className="result-addr">
                      {r.address}, {r.city}
                    </div>
                    {r.violation_categories.length > 0 ? (
                      <div className="result-chips">
                        {r.violation_categories.slice(0, 4).map((key) => {
                          const cat = categoryVisual(key);
                          return (
                            <span
                              key={key}
                              className="qv-chip"
                              style={{ borderColor: cat.color + '55', color: cat.color }}
                            >
                              <span aria-hidden>{cat.icon}</span> {cat.label}
                            </span>
                          );
                        })}
                        {r.violation_categories.length > 4 && (
                          <span className="qv-more">+{r.violation_categories.length - 4}</span>
                        )}
                      </div>
                    ) : (
                      <div className="result-chips">
                        <span className="qv-chip" style={{ borderColor: '#4ade8055', color: 'var(--green)' }}>
                          ✓ Clean
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="score-pill" style={{ background: theme.markerColor }}>
                    {r.latest_score ?? '—'}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
