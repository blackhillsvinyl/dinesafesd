import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fetchRestaurant } from '../lib/api';
import { getScoreTheme } from '../scoring';
import type { RestaurantDetail, Inspection, Violation } from '../types';

function useRestaurant(id: string | undefined) {
  return useQuery({
    queryKey: ['restaurant', id],
    queryFn: (): Promise<RestaurantDetail> => fetchRestaurant(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 30,
  });
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  major: '#f97316',
  minor: '#eab308',
};

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  const { data: restaurant, isLoading, error } = useRestaurant(id);

  if (isLoading) return <div className="center">Loading…</div>;
  if (error || !restaurant) return <div className="center">Restaurant not found.</div>;

  const theme = getScoreTheme(restaurant.latest_score);
  const inspections = restaurant.inspections; // already newest-first

  return (
    <div className="page">
      <div className="detail-header">
        <h1>{restaurant.name}</h1>
        <p className="small">
          {restaurant.address}, {restaurant.city}, {restaurant.state}
        </p>
        <div className="detail-score">
          <div className="score-badge-lg" style={{ background: theme.markerColor }}>
            {restaurant.latest_score ?? '—'}
          </div>
          <div>
            {restaurant.latest_inspection_date && (
              <p>
                Last inspected{' '}
                {format(parseISO(restaurant.latest_inspection_date), 'MMMM d, yyyy')}
              </p>
            )}
            {restaurant.average_score != null && (
              <p className="small">
                Average score {restaurant.average_score.toFixed(1)} over{' '}
                {restaurant.inspection_count} inspection
                {restaurant.inspection_count === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
      </div>

      <h2>Inspection history</h2>
      {inspections.length === 0 && <p className="small">No inspections on record.</p>}
      {inspections.map((inspection: Inspection) => (
        <div key={inspection.date} className="inspection-card">
          <div className="inspection-head">
            <span className="inspection-date">
              {format(parseISO(inspection.date), 'MMMM d, yyyy')}
            </span>
            <span
              className="score-pill-sm"
              style={{ background: getScoreTheme(inspection.score ?? null).markerColor }}
            >
              {inspection.score ?? '—'}
            </span>
          </div>
          {inspection.inspection_type && (
            <p className="small" style={{ marginTop: 4 }}>
              {inspection.inspection_type}
            </p>
          )}
          {inspection.violations.map((v: Violation) => (
            <div key={v.code} className="violation">
              <div
                className="violation-bar"
                style={{ background: SEVERITY_COLORS[v.severity] ?? '#eab308' }}
              />
              <div>
                <div className="violation-code">{v.code}</div>
                <div className="violation-desc">{v.description}</div>
              </div>
            </div>
          ))}
        </div>
      ))}

      <p className="small" style={{ marginTop: 24 }}>
        Data provided by state and local health departments. Inspections are a snapshot in
        time and violations may have been corrected on-site.
      </p>
    </div>
  );
}
