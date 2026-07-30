import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fetchRestaurant } from '../lib/api';
import { getScoreTheme } from '../scoring';
import { markSeen } from '../lib/saved';
import { locationReportMailto } from '../lib/report';
import SaveButtons from '../components/SaveButtons';
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

  // Reading the full report catches a watch up to the latest inspection
  useEffect(() => {
    if (restaurant) markSeen(restaurant.id, restaurant.latest_inspection_date);
  }, [restaurant]);

  if (isLoading) return <div className="center">Loading…</div>;
  if (error || !restaurant) return <div className="center">Restaurant not found.</div>;

  const theme = getScoreTheme(restaurant.latest_score);
  const inspections = restaurant.inspections; // already newest-first

  return (
    <div className="page">
      <div className="detail-header">
        <div className="detail-title">
          <h1>{restaurant.name}</h1>
          <SaveButtons restaurant={restaurant} size="lg" />
        </div>
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

      <h2>Source data</h2>
      <p className="small">
        {restaurant.source === 'sf_sweeps' ? (
          <>
            This establishment is inspected by the City of Sioux Falls Health Department. View
            the official records in the{' '}
            <a href="https://sweepsdata.siouxfalls.gov/" target="_blank" rel="noopener noreferrer">
              Sioux Falls SWEEPS database
            </a>{' '}
            (search for “{restaurant.name}”).
          </>
        ) : (
          <>
            This establishment is inspected by the South Dakota Department of Health. View the
            official records — including original report PDFs — in the{' '}
            <a href="https://sddoh.safefoodinspection.com/" target="_blank" rel="noopener noreferrer">
              SD DOH food inspection portal
            </a>{' '}
            (search for “{restaurant.name}”).
          </>
        )}
      </p>

      <p className="small">
        <a href={locationReportMailto(restaurant)}>Is this place pinned at the wrong spot on the map? Tell us</a> —
        confirmed reports are fixed in the next data update.
      </p>

      <p className="small" style={{ marginTop: 24 }}>
        Data provided by state and local health departments. Inspections are a snapshot in
        time and violations may have been corrected on-site.
      </p>
    </div>
  );
}
