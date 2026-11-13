import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getScoreTheme } from '../scoring';
import { categoryVisual } from '../violationCategories';
import TrendCue from './TrendCue';
import SaveButtons from './SaveButtons';
import { locationReportMailto } from '../lib/report';
import { possiblyClosed } from '../lib/geo';
import { latestStatus, latestStatusLabel } from '../lib/inspection';
import { restaurantPath } from '../lib/meta';
import type { Restaurant } from '../types';

interface Props {
  restaurant: Restaurant;
  onClose: () => void;
}

/**
 * Quick view shown when a map marker is activated: score, what the latest
 * inspection recorded, and a link to the full report.
 */
export default function QuickView({ restaurant: r, onClose }: Props) {
  const theme = getScoreTheme(r.latest_score);
  const categories = r.violation_categories;
  const status = latestStatus(r);
  const ref = useRef<HTMLDivElement>(null);

  // Move focus into the card so keyboard and screen-reader users land on it
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [r.id]);

  return (
    <div
      ref={ref}
      className="quickview"
      role="dialog"
      aria-labelledby="qv-name"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button type="button" className="qv-close" onClick={onClose} aria-label="Close restaurant details">
        <span aria-hidden="true">×</span>
      </button>

      <div className="qv-header">
        <div className="qv-score" style={{ background: theme.bg }}>
          <span className="qv-score-num" style={{ color: theme.color }}>
            {r.latest_score ?? <span aria-hidden="true">—</span>}
          </span>
          {r.latest_score != null ? (
            <span className="qv-score-denom">
              <span aria-hidden="true">/100</span>
              <span className="sr-only">out of 100</span>
            </span>
          ) : (
            <span className="sr-only">No score published</span>
          )}
        </div>
        <div className="qv-info">
          <h2 className="qv-name" id="qv-name">
            {r.name}
          </h2>
          <div className="qv-addr">
            {r.address}, {r.city}
          </div>
          <div className="qv-meta">
            {r.latest_inspection_date && (
              <span className="qv-date">
                Inspected {format(parseISO(r.latest_inspection_date), 'MMM d, yyyy')}
              </span>
            )}
            <TrendCue
              scoreHistory={r.score_history}
              scoreTrend={r.score_trend}
              violationHistory={r.violation_history}
              violationTrend={r.violation_trend}
            />
          </div>
        </div>
      </div>

      {status.kind === 'critical' && (
        <div className="qv-critical">
          <span aria-hidden="true">⚠</span>
          <span>Critical violations found on latest inspection</span>
        </div>
      )}

      {categories.length > 0 ? (
        <div className="qv-chips">
          <span className="qv-chips-label">Violations found:</span>
          {categories.slice(0, 5).map((key) => {
            const cat = categoryVisual(key);
            return (
              <span key={key} className="qv-chip" style={{ borderColor: cat.color }}>
                <span aria-hidden="true">{cat.icon}</span> {cat.label}
              </span>
            );
          })}
          {categories.length > 5 && <span className="qv-more">+{categories.length - 5} more</span>}
        </div>
      ) : (
        r.latest_inspection_date && (
          <div className={status.kind === 'none-recorded' ? 'qv-clean' : 'qv-approx'}>
            {latestStatusLabel(status)}
            {status.kind === 'none-recorded' ? ' on this inspection' : ''}
          </div>
        )
      )}

      {possiblyClosed(r) && (
        <div className="qv-approx">
          No inspection since {r.latest_inspection_date?.slice(0, 4) ?? '2024'} — this place may
          have closed, so it isn&apos;t shown on the map
        </div>
      )}
      {r.geo_precision !== 'rooftop' && r.geo_precision !== 'address' && (
        <div className="qv-approx">Not shown on the map yet — we haven&apos;t verified this exact location</div>
      )}

      <SaveButtons restaurant={r} />

      <Link to={restaurantPath(r.id)} className="qv-cta">
        View full report
        <span className="qv-cta-arrow" aria-hidden="true">
          →
        </span>
      </Link>
      <a className="report-loc" href={locationReportMailto(r)}>
        Wrong spot on the map? Tell us
      </a>
    </div>
  );
}
