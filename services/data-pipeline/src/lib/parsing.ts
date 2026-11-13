// Pure parsing and decision helpers for the two sources. No network, no
// store, no browser — so the rules can be unit-tested with fixtures.

/**
 * Violation count from the SD DOH portal's link text ("Violation(s) 5").
 * A count is only a count when the source printed a number: missing or
 * unreadable text is null (unknown), never zero — zero is shown to visitors
 * as "No violations were recorded".
 */
export function parseViolationCount(text: string | null | undefined): number | null {
  const m = (text ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export interface SweepsViolation {
  code: string;
  description: string;
  severity: 'critical' | 'minor';
}

export interface SweepsInspection {
  date: string; // YYYY-MM-DD
  score: number | null;
  comments: string;
  violations: SweepsViolation[];
  /** null when the page gives no basis for a count (see sweepsViolationCount). */
  violationCount: number | null;
}

/**
 * SWEEPS prints no violation count. Parsed rows are a count; no rows are
 * only "zero" when the score is 100 (the score is 100 minus points deducted,
 * so 100 means nothing was deducted). No rows with a lower score means we
 * failed to read the page, which is unknown, not clean.
 */
export function sweepsViolationCount(parsedRows: number, score: number | null): number | null {
  if (parsedRows > 0) return parsedRows;
  return score === 100 ? 0 : null;
}

/** Parse "1/28/2026" → "2026-01-28" */
export function parseUSDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
}

/**
 * Parse a SWEEPS detail page: the inspections it shows (the page lists
 * violations "for last two inspections", each starting with a
 * <div class="inspection"> header carrying the date and total score) and
 * the establishment phone number.
 */
export function parseSweepsDetail(html: string): { inspections: SweepsInspection[]; phone: string | null } {
  // Row attributes carry "NAME ADDRESS City, SD ZIP PHONE"
  const phone =
    html.match(/nonformattednameaddress="[^"]*?(\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})\s*"/i)?.[1] ?? null;

  const inspections: SweepsInspection[] = [];
  const blocks = html.split(/<div class="inspection">/i);
  for (let b = 1; b < blocks.length; b++) {
    const block = blocks[b];
    const header = block.match(/^\s*Inspection Date:\s*([\d/]+)\s*<br\s*\/?>\s*Total Score:\s*(\d+)/i);
    if (!header) continue;
    const date = parseUSDate(header[1]);
    if (!date) continue;
    const score = parseInt(header[2], 10);

    // Violations for this inspection are grouped under "Critical Violations" /
    // "Non-Critical Violations" headers; each is a <table class="violations">
    // with a title row and a description row. A "No Violations" table may
    // still carry inspector comments.
    const violations: SweepsViolation[] = [];
    let comments = '';
    const sections = block.split(/<div class="violhead">/i);
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const severity: SweepsViolation['severity'] = /^\s*<b>\s*critical/i.test(section) ? 'critical' : 'minor';
      const tableRegex = /<table class="violations">([\s\S]*?)<\/table>/gi;
      let t;
      while ((t = tableRegex.exec(section)) !== null) {
        const table = t[1];
        const commentMatch = table.match(/Inspector Comments:\s*([\s\S]*?)<\/td>/i);
        if (commentMatch) {
          comments = (comments ? comments + ' ' : '') +
            commentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        const title = table.match(/(\d+)\s*points?:\s*<a href='[^']*\/violation\/(\d+)'>([^<]+)<\/a>/i);
        if (!title) continue;
        const descMatch = table.match(/<\/tr>\s*<tr>\s*<td>([\s\S]*?)<\/td>/i);
        const points = title[1];
        const code = title[2];
        const name = title[3].trim();
        const desc = (descMatch ? descMatch[1] : '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const existing = violations.find((v) => v.code === code);
        const description = name + ' (' + points + ' pts): ' + desc;
        if (existing) {
          // UNIQUE(inspection_id, code) — merge repeat citations of the same code
          existing.description += ' | ' + description;
        } else {
          violations.push({ code, description, severity });
        }
      }
    }

    inspections.push({
      date,
      score,
      comments,
      violations,
      violationCount: sweepsViolationCount(violations.length, score),
    });
  }

  return { inspections, phone };
}

export interface DetailFetchInput {
  isNew: boolean;
  /** Score on today's list page (null when the list shows none). */
  listScore: number | null;
  /** Latest score we have stored. */
  knownScore: number | null;
  siteId: string;
  /** Days since the Unix epoch (UTC) — the rotation clock. */
  dayNumber: number;
  /** Every establishment is re-read at least once per this many days. */
  cycleDays: number;
  allDetails: boolean;
}

/**
 * Should today's run read this establishment's detail page?
 *
 * The list page shows only a "Last Score", so a new inspection with the same
 * score as the previous one cannot be seen there. Besides new and
 * changed-score rows, each run therefore re-reads a rotating slice so every
 * establishment — including ones with no list score — is checked at least
 * once per cycle.
 */
export function shouldFetchSweepsDetail(i: DetailFetchInput): 'all' | 'new' | 'score-changed' | 'rotation' | null {
  if (i.allDetails) return 'all';
  if (i.isNew) return 'new';
  if (i.listScore !== null && i.listScore !== i.knownScore) return 'score-changed';
  const cycle = Math.max(1, Math.floor(i.cycleDays));
  const slot = Number.parseInt(i.siteId, 10);
  if (Number.isFinite(slot) && slot % cycle === ((i.dayNumber % cycle) + cycle) % cycle) return 'rotation';
  return null;
}

export function utcDayNumber(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}
