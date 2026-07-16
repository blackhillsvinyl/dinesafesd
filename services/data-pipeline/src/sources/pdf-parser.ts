import pdfParse from 'pdf-parse';

interface Violation {
  code: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  corrected: boolean;
}

interface InspectionData {
  date: Date;
  score: number | null;
  violations: Violation[];
  comments: string;
}

/**
 * Parse an SD DOH "Food Service Inspection Report" PDF (the scoresheet form).
 *
 * Layout (from real reports):
 * - Score:      "Overall Inspection Rating SCORE:\n(100 less weight of items violated)\n97"
 * - Insp. date: "Insp. Date \n7/7/2026"
 * - Item table: numbered rows "29 Clean, proper temperature,\ncleaning agent\n2/2"
 *   where the trailing "earned/weight" pair is glued to the last description
 *   line. earned < weight means the item was violated (weight - earned points
 *   deducted). Critical items carry a leading "*" on the description.
 */
export async function parseInspectionPDF(pdfBuffer: Buffer): Promise<InspectionData> {
  const data = await pdfParse(pdfBuffer);
  const text = data.text;

  const dateMatch = text.match(/Insp\.?\s*Date\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const date = dateMatch ? new Date(dateMatch[1]) : new Date();

  const scoreMatch = text.match(
    /Overall Inspection Rating SCORE:\s*\(100 less weight of items violated\)\s*(\d{1,3})/i
  );
  let score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
  if (score !== null && (score < 0 || score > 100)) score = null;

  const items = extractViolatedItems(text);
  let violations = items.map(({ points: _points, ...v }) => v);

  // Sanity cross-check: deductions in the item table should account for the
  // headline score. Item rows can be cut off by page breaks (undershoot is
  // tolerated), but overshoot means the table was misparsed — trust the
  // headline score and drop the violations rather than store bad items.
  if (score !== null) {
    const deducted = items.reduce((n, v) => n + v.points, 0);
    if (deducted > 100 - score) violations = [];
  }

  return { date, score, violations, comments: '' };
}

function extractViolatedItems(text: string): Array<Violation & { points: number }> {
  const violations: Array<Violation & { points: number }> = [];

  // Item rows: line starts with the item number (1-60), description runs
  // (possibly across lines) until an "earned/weight" pair ends a line.
  // Weights on the SD form are 1-5 points.
  const itemRe = /(?:^|\n)\s{0,3}(\d{1,2})\s+(\*?)([A-Za-z][\s\S]{2,200}?)(\d{1,2})\/([1-5])(?=\s*(?:\n|$))/g;

  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const code = m[1];
    const critical = m[2] === '*' || m[3].includes('*');
    const desc = m[3].replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    const earned = parseInt(m[4], 10);
    const weight = parseInt(m[5], 10);
    if (earned >= weight) continue; // full marks — not a violation
    const num = parseInt(code, 10);
    if (num < 1 || num > 60) continue;

    const points = weight - earned;
    violations.push({
      code,
      description: `${desc} (${points} ${points === 1 ? 'pt' : 'pts'} deducted)`,
      severity: critical ? 'critical' : 'minor',
      corrected: false,
      points: weight - earned,
    });
  }

  // Deduplicate by code (a row split across pages could match twice)
  const seen = new Set<string>();
  return violations.filter((v) => {
    if (seen.has(v.code)) return false;
    seen.add(v.code);
    return true;
  });
}
