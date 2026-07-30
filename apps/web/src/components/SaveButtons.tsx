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
        {fav ? '♥' : '♡'}
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
        👁
      </button>
    </span>
  );
}
