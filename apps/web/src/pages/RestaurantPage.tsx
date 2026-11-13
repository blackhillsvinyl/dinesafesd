import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRestaurant, NotFoundError } from '../lib/api';
import LoadError from '../components/LoadError';
import { hasNewReport, markSeen } from '../lib/saved';
import { NOT_FOUND_META, restaurantMeta } from '../lib/meta';
import { usePageMeta } from '../lib/usePageMeta';
import { prerenderedUpdatedAt } from '../lib/prerendered';
import SaveButtons from '../components/SaveButtons';
import RestaurantReport from '../components/RestaurantReport';
import type { RestaurantDetail, RestaurantIndex } from '../types';

function useRestaurant(id: string | undefined) {
  return useQuery({
    queryKey: ['restaurant', id],
    queryFn: (): Promise<RestaurantDetail> => fetchRestaurant(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 30,
  });
}

function CopyName({ name }: { name: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <button
        type="button"
        className="copy-btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(name);
            setState('copied');
          } catch {
            // Older browsers and locked-down contexts: copy via a selection
            const area = document.createElement('textarea');
            area.value = name;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try {
              ok = document.execCommand('copy');
            } catch {
              ok = false;
            }
            area.remove();
            setState(ok ? 'copied' : 'failed');
          }
        }}
      >
        Copy name
      </button>
      <span className="copy-status" role="status">
        {state === 'copied' ? 'Copied.' : state === 'failed' ? 'Copy not available — select the name and copy it.' : ''}
      </span>
    </>
  );
}

function NotFound() {
  usePageMeta(NOT_FOUND_META);
  return (
    <div className="page">
      <h1>Restaurant not found</h1>
      <p>
        We don’t have an inspection record at this address. The link may be mistyped, or the
        record may have been renamed in the official data.
      </p>
      <p>
        <Link to="/search">Search restaurants</Link> · <Link to="/">Back to the map</Link>
      </p>
    </div>
  );
}

function Report({ restaurant }: { restaurant: RestaurantDetail }) {
  usePageMeta(restaurantMeta(restaurant));
  const queryClient = useQueryClient();
  const index = queryClient.getQueryData<RestaurantIndex>(['restaurant-index']);
  const updatedAt = index?.updated_at ?? prerenderedUpdatedAt();

  // Reading the full report catches a watch up to the latest inspection.
  // Remember whether it was new first, so the page can say so once.
  const wasNew = useRef(hasNewReport(restaurant.id, restaurant.latest_inspection_date));
  useEffect(() => {
    markSeen(restaurant.id, restaurant.latest_inspection_date);
  }, [restaurant]);

  return (
    <RestaurantReport
      restaurant={restaurant}
      dataUpdatedAt={updatedAt}
      actions={
        <>
          {wasNew.current && (
            <p className="new-report-note" role="status">
              <span className="new-report-badge">New report</span> A newer inspection has been
              published since you last viewed this watched restaurant.
            </p>
          )}
          <SaveButtons restaurant={restaurant} size="lg" />
        </>
      }
      copyName={<CopyName name={restaurant.name} />}
    />
  );
}

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  const { data: restaurant, isLoading, error, refetch, isFetching } = useRestaurant(id);

  if (isLoading) {
    return (
      <div className="center" role="status">
        Loading…
      </div>
    );
  }
  // Only a record that does not exist is "not found" (and noindex). An
  // outage is reported as an outage, with a way to retry.
  if (error && !(error instanceof NotFoundError)) {
    return (
      <div className="page">
        <h1>Inspection report</h1>
        <LoadError what="this inspection report" onRetry={() => refetch()} busy={isFetching} />
      </div>
    );
  }
  if (error || !restaurant) return <NotFound />;
  return <Report key={restaurant.id} restaurant={restaurant} />;
}
