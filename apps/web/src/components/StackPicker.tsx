import { useEffect, useRef } from 'react';
import { getScoreTheme } from '../scoring';
import type { Restaurant } from '../types';

interface Props {
  restaurants: Restaurant[];
  onPick: (r: Restaurant) => void;
  onClose: () => void;
}

/**
 * Picker for multiple restaurants at the same address (food court, mall).
 * Tapping a row opens that restaurant's quick view.
 */
export default function StackPicker({ restaurants, onPick, onClose }: Props) {
  // Only claim a shared address/city when the group actually shares one —
  // groups can also be map-area rollups of nearby (or approximately-located)
  // restaurants with different addresses.
  const addresses = new Set(restaurants.map((r) => r.address.toUpperCase().trim()));
  const cities = new Set(restaurants.map((r) => r.city.toUpperCase().trim()));
  const subtitle =
    addresses.size === 1
      ? `${restaurants[0].address}, ${restaurants[0].city}`
      : cities.size === 1
        ? `Near each other in ${restaurants[0].city}`
        : 'Grouped on the map — tap one for details';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [restaurants]);
  return (
    <div
      ref={ref}
      className="quickview stack-picker"
      role="dialog"
      aria-labelledby="sp-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button type="button" className="qv-close" onClick={onClose} aria-label="Close restaurant list">
        <span aria-hidden="true">×</span>
      </button>
      <div className="sp-head">
        <div className="sp-title" id="sp-title">
          {restaurants.length} restaurants {addresses.size === 1 ? 'here' : 'in this group'}
        </div>
        <div className="sp-addr">{subtitle}</div>
      </div>
      <div className="sp-list">
        {restaurants.map((r) => {
          const theme = getScoreTheme(r.latest_score);
          return (
            <button type="button" key={r.id} className="sp-row" onClick={() => onPick(r)}>
              <span className="sp-name">{r.name}</span>
              <span className="sp-score" style={{ background: theme.markerColor, color: theme.onMarker }}>
                {r.latest_score ?? <span aria-hidden="true">—</span>}
                <span className="sr-only">{r.latest_score != null ? ' out of 100' : 'No score published'}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
