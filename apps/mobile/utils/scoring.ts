/**
 * Centralized scoring colors.
 *
 * Scores are shown raw (out of 100) — no adjective labels. Colors step
 * dark green → light green → yellow → orange → red so adjacent bands stay
 * distinguishable at a glance on the map.
 */

export interface ScoreTheme {
  color: string;     // Text / accent color
  bg: string;        // Light background
  markerColor: string; // Map pin color
}

const TIERS: { min: number; theme: ScoreTheme }[] = [
  { min: 96,  theme: { color: '#15803d', bg: '#dcfce7', markerColor: '#15803d' } },
  { min: 90,  theme: { color: '#16a34a', bg: '#f0fdf4', markerColor: '#4ade80' } },
  { min: 83,  theme: { color: '#a16207', bg: '#fef9c3', markerColor: '#facc15' } },
  { min: 76,  theme: { color: '#c2410c', bg: '#ffedd5', markerColor: '#f97316' } },
  { min: 0,   theme: { color: '#b91c1c', bg: '#fee2e2', markerColor: '#dc2626' } },
];

const NO_SCORE: ScoreTheme = {
  color: '#94a3b8',
  bg: '#f1f5f9',
  markerColor: '#94a3b8',
};

export function getScoreTheme(score: number | null): ScoreTheme {
  if (score === null) return NO_SCORE;
  for (const tier of TIERS) {
    if (score >= tier.min) return tier.theme;
  }
  return TIERS[TIERS.length - 1].theme;
}

export function getScoreColor(score: number | null): string {
  return getScoreTheme(score).color;
}

export function getMarkerColor(score: number | null): string {
  return getScoreTheme(score).markerColor;
}

export function getScoreBg(score: number | null): string {
  return getScoreTheme(score).bg;
}

/** Perfect score with presumed zero violations */
export function isPerfectScore(score: number | null): boolean {
  return score === 100;
}
