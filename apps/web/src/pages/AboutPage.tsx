import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fetchIndex } from '../lib/api';
import { SCORE_BANDS } from '../scoring';
import { BASIS_EXPLANATION, SCORE_VS_CRITICAL } from '../lib/inspection';
import { SD_DOH_SEARCH, SWEEPS_HOME } from '../lib/sources';
import { SAVE_HELP } from '../components/SaveButtons';
import { HOME_INTRO } from '../lib/meta';

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
      <p>{HOME_INTRO}</p>

      <h2>Data source</h2>
      <p>
        Inspection data is public record, sourced from the South Dakota Department of Health
        (covering all 66 counties) and the City of Sioux Falls Health Department&apos;s SWEEPS
        program. We check the official sources daily.
        {lastUpdated && <> Our copy was last refreshed on {format(lastUpdated, 'MMMM d, yyyy')}.</>}{' '}
        That refresh date is not an inspection date: every restaurant shows the date of its own
        latest inspection.
      </p>
      <p>
        You can always consult the unadulterated official records directly:{' '}
        <a href={SD_DOH_SEARCH} target="_blank" rel="noopener noreferrer">
          SD DOH public inspection search
        </a>{' '}
        (statewide) and the{' '}
        <a href={SWEEPS_HOME} target="_blank" rel="noopener noreferrer">
          Sioux Falls SWEEPS database
        </a>{' '}
        (City of Sioux Falls). Every full report page here links to the matching source.
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
        {SCORE_BANDS.map(({ range, theme }) => (
          <li key={range}>
            <span className="legend-dot" style={{ background: theme.markerColor }} />
            <b>{range}</b>
          </li>
        ))}
      </ul>

      <h2 id="severity">Critical violations and severity labels</h2>
      <p>{SCORE_VS_CRITICAL}</p>
      <p>
        We only show a severity that the official record states. Where it comes from depends
        on the record:
      </p>
      <ul>
        <li>
          <b>Sioux Falls reports:</b> {BASIS_EXPLANATION.sweeps}
        </li>
        <li>
          <b>State scoresheets:</b> {BASIS_EXPLANATION.scoresheet}
        </li>
        <li>
          <b>State portal citations:</b> {BASIS_EXPLANATION.portal}
        </li>
      </ul>
      <p>
        When an inspection has no itemized violations in the official data, we say so rather
        than describe it as clean.
      </p>

      <h2 id="saved">Save and Watch</h2>
      <p>{SAVE_HELP}</p>

      <h2>Apps</h2>
      <p>
        DineSafeSD is a free website — no account, no install. Native iPhone and Android apps
        are in the works; in the meantime the site works great on your phone (add it to your
        home screen).
      </p>

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
