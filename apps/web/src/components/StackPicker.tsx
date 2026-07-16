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
  return (
    <div className="quickview stack-picker" role="dialog" aria-label="Restaurants at this location">
      <button className="qv-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="sp-head">
        <div className="sp-title">
          {restaurants.length} restaurants {addresses.size === 1 ? 'here' : 'in this group'}
        </div>
        <div className="sp-addr">{subtitle}</div>
      </div>
      <div className="sp-list">
        {restaurants.map((r) => {
          const theme = getScoreTheme(r.latest_score);
          return (
            <button key={r.id} className="sp-row" onClick={() => onPick(r)}>
              <span className="sp-name">{r.name}</span>
              <span className="sp-score" style={{ background: theme.markerColor }}>
                {r.latest_score ?? '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
