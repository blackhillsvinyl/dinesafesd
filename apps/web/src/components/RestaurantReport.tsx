import type { ReactNode } from 'react';
import { getScoreTheme } from '../scoring';
import {
  BASIS_EXPLANATION,
  BASIS_SHORT,
  SCORE_VS_CRITICAL,
  SWEEPS_ZERO_NOTE,
  findingsSentence,
  inspectionFindings,
  publishedSeverity,
  severityBasis,
  severityLabel,
} from '../lib/inspection';
import type { SeverityBasis } from '../lib/inspection';
import { officialSource } from '../lib/sources';
import { locationReportMailto } from '../lib/report';
import { longDate } from '../lib/meta';
import type { Inspection, RestaurantDetail } from '../types';

interface Props {
  restaurant: RestaurantDetail;
  /** When the DineSafeSD dataset was last refreshed (ISO timestamp). */
  dataUpdatedAt?: string | null;
  /** Save / watch controls — supplied by the interactive page only. */
  actions?: ReactNode;
  /** Copy-name control — supplied by the interactive page only. */
  copyName?: ReactNode;
}

const BASIS_ORDER: SeverityBasis[] = ['sweeps', 'scoresheet', 'portal'];

function ScorePill({ score }: { score: number | null }) {
  const theme = getScoreTheme(score);
  return (
    <span className="score-pill-sm" style={{ background: theme.markerColor, color: theme.onMarker }}>
      {score != null ? (
        <>
          {score}
          <span className="sr-only"> out of 100</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">No score published</span>
        </>
      )}
    </span>
  );
}

function InspectionCard({ inspection, source }: { inspection: Inspection; source: string }) {
  const findings = inspectionFindings(inspection, source);
  return (
    <section className="inspection-card">
      <div className="inspection-head">
        <h3 className="inspection-date">{longDate(inspection.date)}</h3>
        <ScorePill score={inspection.score} />
      </div>
      {inspection.inspection_type && <p className="inspection-type">{inspection.inspection_type}</p>}
      <p className="inspection-findings">{findingsSentence(findings, { source, score: inspection.score })}</p>
      {inspection.violations.length > 0 && (
        <ul className="violation-list">
          {inspection.violations.map((v) => {
            const basis = severityBasis(source, v.code);
            const label = severityLabel(v, source);
            const critical = publishedSeverity(v, source) === 'critical';
            return (
              <li key={v.code} className={`violation${critical ? ' violation-critical' : ''}`}>
                <div className="violation-meta">
                  <span className={`sev sev-${critical ? 'critical' : 'other'}`}>{label}</span>
                  <span className="sev-basis">{BASIS_SHORT[basis]}</span>
                  <span className="violation-code">Code {v.code}</span>
                </div>
                <div className="violation-desc">{v.description}</div>
                {v.corrected && <div className="violation-corrected">Corrected on site, per the inspector’s comments.</div>}
              </li>
            );
          })}
        </ul>
      )}
      {inspection.comments && (
        <p className="inspection-comments">
          <b>Inspector comments:</b> {inspection.comments}
        </p>
      )}
    </section>
  );
}

/**
 * The full inspection report for one establishment. Pure and router-free so
 * the same component renders in the browser and in the build-time prerender.
 */
export default function RestaurantReport({ restaurant: r, dataUpdatedAt, actions, copyName }: Props) {
  const inspections = r.inspections; // newest first
  const latest = inspections[0] ?? null;
  const latestFindings = latest ? inspectionFindings(latest, r.source) : null;
  const hasCritical = latestFindings?.kind === 'itemized' && latestFindings.critical > 0;
  // The headline score is the latest inspection's own score. If that
  // inspection has none, say which inspection the number belongs to.
  const scored = inspections.find((i) => i.score != null) ?? null;
  const scoreTheme = getScoreTheme(scored?.score ?? null);
  const scoreIsOlder = !!scored && !!latest && scored.date !== latest.date;
  const basesUsed = BASIS_ORDER.filter((b) =>
    inspections.some((i) => i.violations.some((v) => severityBasis(r.source, v.code) === b))
  );
  const source = officialSource(r);
  const sweepsZero =
    r.source === 'sf_sweeps' &&
    inspections.some((i) => i.score === 100 && inspectionFindings(i, r.source).kind === 'none-recorded');

  return (
    <article className="page report">
      <header className="detail-header">
        <h1>{r.name}</h1>
        <p className="detail-addr">
          {r.address}, {r.city}, {r.state}
          {r.zip_code ? ` ${r.zip_code}` : ''}
        </p>
      </header>

      <section className="latest-summary" aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="latest-label">
          Latest inspection
        </h2>
        {latest ? (
          <>
            <p className="latest-date">{longDate(latest.date)}</p>
            <div className="detail-score">
              <div
                className="score-badge-lg"
                style={{ background: scoreTheme.markerColor, color: scoreTheme.onMarker }}
              >
                {scored ? scored.score : <span aria-hidden="true">—</span>}
              </div>
              <div className="detail-score-text">
                <p className="detail-score-label">
                  {scored ? (
                    <>Inspection score: {scored.score} out of 100</>
                  ) : (
                    <>No inspection score has been published</>
                  )}
                </p>
                {scoreIsOlder && (
                  <p className="detail-note">
                    This score is from the {longDate(scored!.date)} inspection. No score is published
                    for the latest inspection.
                  </p>
                )}
                {r.average_score != null && (
                  <p className="detail-note">
                    Average score {r.average_score.toFixed(1)} over {r.inspection_count} inspection
                    {r.inspection_count === 1 ? '' : 's'} on record
                  </p>
                )}
              </div>
            </div>

            {hasCritical ? (
              <div className="status status-critical">
                <p>
                  <strong>Critical violations recorded on this inspection.</strong>{' '}
                  {findingsSentence(latestFindings!)}
                </p>
                <p>{SCORE_VS_CRITICAL}</p>
                <p>
                  “Critical” is the mark on the official report.{' '}
                  <a href="#severity-heading">How severity is labeled</a>
                </p>
              </div>
            ) : (
              <p className="status status-neutral">
                {findingsSentence(latestFindings!, { source: r.source, score: latest.score })}
                {latestFindings?.kind === 'itemized' && latestFindings.unpublished > 0 && (
                  <>
                    {' '}
                    <a href="#severity-heading">How severity is labeled</a>
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="status status-neutral">No inspections on record.</p>
        )}
        <p className="detail-note">
          Dates shown are when the inspector visited.
          {dataUpdatedAt && (
            <> DineSafeSD last refreshed its copy of the official data on {longDate(dataUpdatedAt.slice(0, 10))}.</>
          )}
        </p>
      </section>

      {actions}

      <h2>Inspection history</h2>
      {inspections.length === 0 && <p className="detail-note">No inspections on record.</p>}
      {inspections.map((inspection) => (
        <InspectionCard key={inspection.date} inspection={inspection} source={r.source} />
      ))}

      {basesUsed.length > 0 && (
        <>
          <h2 id="severity-heading">How severity is labeled</h2>
          {basesUsed.map((b) => (
            <p key={b} className="detail-note">
              <b>“{BASIS_SHORT[b]}”:</b> {BASIS_EXPLANATION[b]}
            </p>
          ))}
        </>
      )}
      {sweepsZero && (
        <p className="detail-note">
          <b>“No violations listed”:</b> {SWEEPS_ZERO_NOTE}
        </p>
      )}

      <h2>Verify with the official source</h2>
      <p className="detail-note">This establishment is inspected by the {source.agency}.</p>
      {source.deepLink ? (
        <p className="detail-note">
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            Open this establishment’s official record in the {source.portalName}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          . If the link does not open the record, search the SWEEPS list for “{r.name}”.
        </p>
      ) : (
        <>
          <p className="detail-note">
            The state portal cannot be linked to a single establishment, so verifying takes a short
            search:
          </p>
          <ol className="source-steps">
            <li>
              Copy the name exactly as the state lists it: <b className="source-name">{r.name}</b> {copyName}
            </li>
            <li>
              Open the{' '}
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.portalName}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </li>
            <li>
              Paste the name into <b>Establishment Name</b>, enter <b>{r.city}</b> as the city, and
              select <b>Search</b>. Original report PDFs are attached to each inspection there.
            </li>
          </ol>
        </>
      )}

      <p className="detail-note">
        <a href={locationReportMailto(r)}>Is this place pinned at the wrong spot on the map? Tell us</a>
        . Confirmed reports are fixed in the next data update.
      </p>

      <p className="detail-note detail-disclaimer">
        Data provided by state and local health departments. Inspections are a snapshot in time and
        violations may have been corrected on-site.
      </p>
    </article>
  );
}
