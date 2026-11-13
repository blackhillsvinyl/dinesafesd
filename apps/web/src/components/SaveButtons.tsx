import { useState } from 'react';
import {
  isFavorite,
  isWatched,
  lastChangePersisted,
  toggleFavorite,
  toggleWatch,
  useSavedVersion,
} from '../lib/saved';
import type { Restaurant } from '../types';

interface Props {
  restaurant: Pick<Restaurant, 'id' | 'latest_inspection_date'>;
  size?: 'sm' | 'lg';
}

export const SAVE_HELP =
  'Save adds this place to Favorites in Search. Watch shows a “New report” badge in Search and Latest when a newer inspection is published. Both are stored only in this browser on this device: no account, and no emails or notifications are sent.';

const NOT_STORED =
  'This browser is blocking storage, so this will only last until you close the page.';

/** Save (favorite) + Watch toggles with visible labels and plain-language feedback. */
export default function SaveButtons({ restaurant: r, size = 'sm' }: Props) {
  useSavedVersion();
  const fav = isFavorite(r.id);
  const watched = isWatched(r.id);
  const [message, setMessage] = useState('');

  const report = (ok: string) => setMessage(lastChangePersisted() ? ok : NOT_STORED);

  return (
    <div className={`save-area save-area-${size}`}>
      <div className="save-btns">
        <button
          type="button"
          className={`save-btn${fav ? ' on' : ''}`}
          onClick={() => {
            toggleFavorite(r.id);
            report(
              fav
                ? 'Removed from Favorites on this device.'
                : 'Saved to Favorites on this device. Find it in Search under Favorites.'
            );
          }}
          aria-pressed={fav}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
              fill={fav ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          Save
        </button>
        <button
          type="button"
          className={`save-btn watch${watched ? ' on' : ''}`}
          onClick={() => {
            toggleWatch(r.id, r.latest_inspection_date);
            report(
              watched
                ? 'Stopped watching on this device.'
                : 'Watching on this device. A “New report” badge will appear next to this place in Search and Latest when a newer inspection is published. No emails or notifications are sent.'
            );
          }}
          aria-pressed={watched}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.6" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" />
          </svg>
          Watch
        </button>
      </div>
      <p className="save-status" role="status">
        {message}
      </p>
      {size === 'lg' && <p className="save-help">{SAVE_HELP}</p>}
    </div>
  );
}
