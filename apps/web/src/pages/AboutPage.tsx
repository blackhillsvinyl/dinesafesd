import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fetchIndex } from '../lib/api';
import { getScoreTheme } from '../scoring';

// Representative score per band drives the legend swatch color
const SCORE_LEGEND = [
  { range: '96–100', min: 96 },
  { range: '90–95', min: 90 },
  { range: '83–89', min: 83 },
  { range: '76–82', min: 76 },
  { range: 'Below 76', min: 0 },
];

function useDataFreshness() {
  return useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
    select: (index) => new Date(index.updated_at),
  });
}

export default function AboutPage() {
  const { data: lastUpdated } = useDataFreshness();

  return (
    <div className="page">
      <h1>About DineSafeSD</h1>
      <p>
        DineSafeSD is a free app for browsing restaurant health inspection results across South
        Dakota. Search by name or location, view scores, and read detailed inspection reports —
        all in one place.
      </p>

      <h2>Data source</h2>
      <p>
        Inspection data is public record, sourced from the South Dakota Department of Health
        (covering all 66 counties) and the City of Sioux Falls Health Department&apos;s SWEEPS
        program. Data is refreshed daily.
        {lastUpdated && <> Data updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}.</>}
      </p>

      <h2>Coverage and limitations</h2>
      <ul>
        <li>
          <b>Tribal lands:</b> restaurants on reservations are typically inspected by the Indian
          Health Service or tribal authorities, not the SD Department of Health, so they may not
          appear here.
        </li>
        <li>
          <b>Sioux Falls history:</b> the city&apos;s SWEEPS system publishes full violation
          details only for each restaurant&apos;s two most recent inspections; older inspections
          show scores without itemized violations.
        </li>
        <li>
          <b>Statewide history:</b> the state portal lists past inspection dates and violation
          counts; we fill in historical scores from the original inspection report PDFs where the
          state makes them available.
        </li>
        <li>
          <b>Scope:</b> we include food-service inspections only — lodging, pool, and other
          license types are out of scope.
        </li>
      </ul>

      <h2>Score guide</h2>
      <p>
        Scores are shown exactly as reported by the health department, out of 100. We don&apos;t
        editorialize — map and score colors simply step from green (higher scores) through
        yellow and orange to red (lower scores):
      </p>
      <ul className="score-legend">
        {SCORE_LEGEND.map(({ range, min }) => (
          <li key={range}>
            <span className="legend-dot" style={{ background: getScoreTheme(min).markerColor }} />
            <b>{range}</b>
          </li>
        ))}
      </ul>

      <h2>Get the app</h2>
      <p>DineSafeSD is available for iPhone and Android — free, no account required.</p>

      <h2>Legal</h2>
      <p>
        <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Use</Link> ·{' '}
        <Link to="/support">Support</Link>
      </p>

      <p className="small" style={{ marginTop: 24 }}>
        This app is for informational purposes only. Inspection results are a snapshot in time
        and violations may have been corrected on-site. Always use your own judgment when
        choosing where to eat.
      </p>
    </div>
  );
}
