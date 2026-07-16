// Shapes of the static JSON published by the pipeline
// (services/data-pipeline/src/lib/store.ts). Restaurant ids are the pipeline's
// deterministic external ids (e.g. "sd_doh_<slug>", "sf_sweeps_<siteId>").

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  source: string;
  latest_score: number | null;
  latest_inspection_date: string | null;
  average_score: number | null;
  inspection_count: number;
  has_critical_violations: boolean;
  violation_categories: string[];
  score_history: ScorePoint[];
  score_trend: 'up' | 'down' | 'flat' | null;
  violation_history: ViolationPoint[];
  violation_trend: 'up' | 'down' | 'flat' | null;
  geo_precision?: 'rooftop' | 'address' | 'street' | 'city' | null;
  source_address?: string | null;
}

export interface ScorePoint {
  date: string;
  score: number;
}

export interface ViolationPoint {
  date: string;
  count: number;
}

export interface Violation {
  code: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  corrected: boolean;
}

export interface Inspection {
  date: string; // YYYY-MM-DD
  score: number | null;
  grade: string | null;
  inspection_type: string | null;
  comments: string;
  violations: Violation[];
}

export interface RestaurantDetail extends Restaurant {
  inspections: Inspection[]; // newest first
}

export interface SourceRun {
  status: 'success' | 'failure';
  finished_at: string;
  restaurants_upserted: number | null;
  inspections_upserted: number | null;
  error: string | null;
}

export interface RestaurantIndex {
  updated_at: string;
  sources: Record<string, SourceRun>;
  restaurants: Restaurant[];
}

export interface RestaurantWithDistance extends Restaurant {
  distanceMeters: number;
}

export interface FilterState {
  minScore: number;
  maxDistance: number;
  recentOnly: boolean;
  hideCritical: boolean;
  violationTypes: string[];
}

export type SortOption = 'score' | 'distance' | 'recent';
