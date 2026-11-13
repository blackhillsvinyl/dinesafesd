// Mirrors apps/mobile/utils/scoring.ts
//
// Scores are shown raw (out of 100) — no adjective labels. Colors step
// dark green → light green → yellow → orange → red so adjacent bands stay
// distinguishable at a glance on the map.

export interface ScoreTheme {
  color: string; // Text / accent color
  bg: string; // Light background
  markerColor: string; // Map pin color
  onMarker: string; // Text color on a markerColor background (≥ 4.5:1)
}

export const TIERS: { min: number; theme: ScoreTheme }[] = [
  { min: 96, theme: { color: '#15803d', bg: '#dcfce7', markerColor: '#15803d', onMarker: '#ffffff' } },
  { min: 90, theme: { color: '#15803d', bg: '#f0fdf4', markerColor: '#4ade80', onMarker: '#052e16' } },
  { min: 83, theme: { color: '#a16207', bg: '#fef9c3', markerColor: '#facc15', onMarker: '#422006' } },
  { min: 76, theme: { color: '#c2410c', bg: '#ffedd5', markerColor: '#f97316', onMarker: '#431407' } },
  { min: 0, theme: { color: '#b91c1c', bg: '#fee2e2', markerColor: '#dc2626', onMarker: '#ffffff' } },
];

const NO_SCORE: ScoreTheme = {
  color: '#475569',
  bg: '#f1f5f9',
  markerColor: '#94a3b8',
  onMarker: '#0f172a',
};

export function getScoreTheme(score: number | null): ScoreTheme {
  if (score === null || score === undefined) return NO_SCORE;
  for (const tier of TIERS) {
    if (score >= tier.min) return tier.theme;
  }
  return NO_SCORE;
}

/** Legend rows, best to worst, in plain numbers. */
export const SCORE_BANDS: { range: string; theme: ScoreTheme }[] = [
  { range: '96–100', theme: TIERS[0].theme },
  { range: '90–95', theme: TIERS[1].theme },
  { range: '83–89', theme: TIERS[2].theme },
  { range: '76–82', theme: TIERS[3].theme },
  { range: 'Below 76', theme: TIERS[4].theme },
];

export const NO_SCORE_THEME = NO_SCORE;

/** WCAG relative-luminance contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
