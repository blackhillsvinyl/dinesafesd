import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getScoreTheme } from '../scoring';
import { categoryVisual } from '../violationCategories';
import { isFavorite, hasNewReport } from '../lib/saved';
import { latestStatus, latestStatusLabel } from '../lib/inspection';
import { restaurantPath } from '../lib/meta';
import TrendCue from './TrendCue';
import type { Restaurant } from '../types';

interface Props {
  restaurant: Restaurant;
  /** Show violation category chips (Latest feed). */
  chips?: boolean;
  /** Show the inspection date on the card (Search — the feed groups by date). */
  date?: boolean;
}

/** One restaurant in a result list: name, address, what the latest inspection recorded, score. */
export default function ResultCard({ restaurant: r, chips = false, date = false }: Props) {
  const theme = getScoreTheme(r.latest_score);
  const status = latestStatus(r);
  return (
    <Link to={restaurantPath(r.id)} className="result-card">
      <div className="result-info">
        <div className="result-name">
          {r.name}
          {isFavorite(r.id) && (
            <span className="saved-mark">
              {' '}
              <span aria-hidden="true">♥</span>
              <span className="sr-only">Saved favorite</span>
            </span>
          )}
          {hasNewReport(r.id, r.latest_inspection_date) && (
            <span className="new-report-badge">New report</span>
          )}
        </div>
        <div className="result-addr">
          {r.address}, {r.city}, {r.state}
        </div>
        <div className={`result-status${status.kind === 'critical' ? ' critical' : ''}`}>
          {status.kind === 'critical' && <span aria-hidden="true">⚠ </span>}
          {latestStatusLabel(status)}
          {date && r.latest_inspection_date && (
            <span className="result-date">
              {' '}
              · Inspected {format(parseISO(r.latest_inspection_date), 'MMM d, yyyy')}
            </span>
          )}
        </div>
        {chips && r.violation_categories.length > 0 && (
          <div className="result-chips">
            {r.violation_categories.slice(0, 4).map((key) => {
              const cat = categoryVisual(key);
              return (
                <span key={key} className="qv-chip" style={{ borderColor: cat.color }}>
                  <span aria-hidden="true">{cat.icon}</span> {cat.label}
                </span>
              );
            })}
            {r.violation_categories.length > 4 && (
              <span className="qv-more">+{r.violation_categories.length - 4} more</span>
            )}
          </div>
        )}
        <TrendCue
          scoreHistory={r.score_history}
          violationHistory={r.violation_history}
        />
      </div>
      <div className="score-pill" style={{ background: theme.markerColor, color: theme.onMarker }}>
        {r.latest_score ?? <span aria-hidden="true">—</span>}
        <span className="sr-only">{r.latest_score != null ? ' out of 100' : 'No score published'}</span>
      </div>
    </Link>
  );
}
