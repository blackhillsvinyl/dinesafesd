import {
  isFavorite,
  isWatched,
  toggleFavorite,
  toggleWatch,
  useSavedVersion,
} from '../lib/saved';
import type { Restaurant } from '../types';

interface Props {
  restaurant: Pick<Restaurant, 'id' | 'latest_inspection_date'>;
  size?: 'sm' | 'lg';
}

/** Heart (favorite) + eye (watch) toggles, shared by quick view and report. */
export default function SaveButtons({ restaurant: r, size = 'sm' }: Props) {
  useSavedVersion();
  const fav = isFavorite(r.id);
  const watched = isWatched(r.id);
  return (
    <span className={`save-btns save-btns-${size}`}>
      <button
        className={`save-btn${fav ? ' on' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite(r.id);
        }}
        aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={fav}
        title={fav ? 'Favorited' : 'Favorite'}
      >
        {/* flat heart, same stroke family as the eye */}
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill={fav ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className={`save-btn watch${watched ? ' on' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleWatch(r.id, r.latest_inspection_date);
        }}
        aria-label={watched ? 'Stop watching' : 'Watch for new reports'}
        aria-pressed={watched}
        title={watched ? 'Watching — you’ll see a badge when a new report lands' : 'Watch'}
      >
        {/* flat single-color eye, matches the glyph heart */}
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path
            d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.6" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
    </span>
  );
}
