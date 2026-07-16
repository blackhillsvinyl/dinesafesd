// Mirrors apps/mobile/lib/violationCategories.ts (Ionicons → emoji equivalents).
// Keys match the categories the pipeline publishes in violation_categories.

export interface CategoryVisual {
  label: string;
  icon: string;
  color: string;
}

export const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  pests: { label: 'Pests', icon: '🐭', color: '#ef4444' },
  handwashing: { label: 'Handwashing', icon: '🧼', color: '#f97316' },
  temperature: { label: 'Temperature', icon: '🌡️', color: '#ef4444' },
  cleanliness: { label: 'Cleanliness', icon: '🦠', color: '#f97316' },
  contamination: { label: 'Contamination', icon: '⚠️', color: '#ef4444' },
  chemicals: { label: 'Chemicals', icon: '🧪', color: '#ef4444' },
  plumbing: { label: 'Plumbing', icon: '💧', color: '#3b82f6' },
  personnel: { label: 'Personnel', icon: '👤', color: '#8b5cf6' },
  facility: { label: 'Facility', icon: '🏢', color: '#6b7280' },
  equipment: { label: 'Equipment', icon: '🔧', color: '#6b7280' },
  storage: { label: 'Storage', icon: '📦', color: '#6b7280' },
  other: { label: 'Other', icon: '❗', color: '#9ca3af' },
};

export function categoryVisual(key: string): CategoryVisual {
  return CATEGORY_VISUALS[key] ?? { ...CATEGORY_VISUALS.other, label: key };
}
