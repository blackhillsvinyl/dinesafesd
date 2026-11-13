interface Props {
  what: string;
  onRetry: () => void;
  busy?: boolean;
}

/** A temporary failure to load data: say so, and offer a retry. Never "not found". */
export default function LoadError({ what, onRetry, busy = false }: Props) {
  return (
    <div className="empty-state load-error" role="alert">
      <p className="empty-title">We couldn’t load {what}.</p>
      <p>This looks like a temporary connection or server problem, not a missing record.</p>
      <div className="empty-actions">
        <button type="button" className="filter-chip" onClick={onRetry} disabled={busy}>
          {busy ? 'Trying again…' : 'Try again'}
        </button>
      </div>
    </div>
  );
}

export function SourceNotices({ notices }: { notices: string[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="source-notice" role="status">
      {notices.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}
