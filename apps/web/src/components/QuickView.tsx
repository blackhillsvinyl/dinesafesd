import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getScoreTheme } from '../scoring';
import { categoryVisual } from '../violationCategories';
import TrendCue from './TrendCue';
import type { Restaurant } from '../types';

interface Props {
  restaurant: Restaurant;
  onClose: () => void;
}

/**
 * Quick view shown when a map marker is clicked: score, violation category
 * icons from the latest inspection, and a link to the full report.
 */
export default function QuickView({ restaurant: r, onClose }: Props) {
  const theme = getScoreTheme(r.latest_score);
  const categories = r.violation_categories;

  return (
    <div className="quickview" role="dialog" aria-label={r.name}>
      <button className="qv-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className="qv-header">
        <div className="qv-score" style={{ background: theme.bg }}>
          <span className="qv-score-num" style={{ color: theme.color }}>
            {r.latest_score ?? '—'}
          </span>
          {r.latest_score != null && <span className="qv-score-denom">/100</span>}
        </div>
        <div className="qv-info">
          <div className="qv-name">{r.name}</div>
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

      {categories.length > 0 ? (
        <div className="qv-chips">
          <span className="qv-chips-label">Violations found:</span>
          {categories.slice(0, 5).map((key) => {
            const cat = categoryVisual(key);
            return (
              <span key={key} className="qv-chip" style={{ borderColor: cat.color + '55', color: cat.color }}>
                <span aria-hidden>{cat.icon}</span> {cat.label}
              </span>
            );
          })}
          {categories.length > 5 && <span className="qv-more">+{categories.length - 5}</span>}
        </div>
      ) : (
        r.latest_inspection_date && (
          <div className="qv-clean">✓ Clean inspection — no violations</div>
        )
      )}

      {r.has_critical_violations && (
        <div className="qv-critical">⚠ Critical violations found on latest inspection</div>
      )}

      {r.geo_precision === 'city' && (
        <div className="qv-approx">Map location is approximate — this address isn&apos;t mappable yet</div>
      )}

      <Link to={`/r/${encodeURIComponent(r.id)}`} className="qv-cta">
        View Full Report →
      </Link>
    </div>
  );
}
