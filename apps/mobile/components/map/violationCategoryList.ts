export const VIOLATION_CATEGORIES = [
  { key: 'pests', label: 'Pests', icon: 'bug' as const, color: '#ef4444' },
  { key: 'handwashing', label: 'Handwashing', icon: 'hand-left' as const, color: '#f97316' },
  { key: 'temperature', label: 'Temperature', icon: 'thermometer' as const, color: '#ef4444' },
  { key: 'cleanliness', label: 'Cleanliness', icon: 'sparkles' as const, color: '#f97316' },
  { key: 'contamination', label: 'Contamination', icon: 'warning' as const, color: '#ef4444' },
  { key: 'chemicals', label: 'Chemicals', icon: 'flask' as const, color: '#ef4444' },
  { key: 'plumbing', label: 'Plumbing', icon: 'water' as const, color: '#3b82f6' },
  { key: 'personnel', label: 'Personnel', icon: 'person' as const, color: '#8b5cf6' },
  { key: 'facility', label: 'Facility', icon: 'business' as const, color: '#6b7280' },
  { key: 'equipment', label: 'Equipment', icon: 'construct' as const, color: '#6b7280' },
  { key: 'storage', label: 'Storage', icon: 'cube' as const, color: '#6b7280' },
  { key: 'other', label: 'Other', icon: 'alert-circle' as const, color: '#9ca3af' },
] as const;
