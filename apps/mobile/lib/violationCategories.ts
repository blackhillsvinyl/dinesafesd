import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

export interface ViolationCategory {
  key: string;
  label: string;
  icon: IoniconsName;
  color: string;
}

// "Pests" is reserved for evidence of actual pest activity — not prevention
// citations (door gaps, screens, trap placement) and not words like "raw
// animal food" or "pesticide". Mirrors services/data-pipeline/src/lib/store.ts.
const PEST_NOUN = /\b(mice|mouse|rodents?|rats?|roach\w*|cockroach\w*|insects?|flies|fly|gnats?|vermin|pests?)\b/i;
const PEST_STRONG_EVIDENCE = /feces|droppings|excrement|infestation|dead (flies|insects|pests|rodents|mice)/i;
const PEST_OBSERVED = /\b(observed|noted|seen|found|present|presence|activity|alive|dead)\b/i;
const PEST_PREVENTION_ONLY = /would allow|entrance|entry of|protect|screen|door sweep|electrocution|trapping device|air curtain|fly ?strip/i;

function isPestEvidence(description: string): boolean {
  if (PEST_STRONG_EVIDENCE.test(description)) return true;
  return (
    PEST_NOUN.test(description) &&
    PEST_OBSERVED.test(description) &&
    !PEST_PREVENTION_ONLY.test(description)
  );
}

const PESTS_CATEGORY: ViolationCategory = { key: 'pests', label: 'Pests', icon: 'bug', color: '#ef4444' };

// Maps violation description prefixes (the category before " — ") to visual categories
const CATEGORY_MATCHERS: Array<{
  pattern: RegExp;
  category: ViolationCategory;
}> = [
  {
    pattern: /handwash|hand wash|wash(ing)? hands/i,
    category: { key: 'handwashing', label: 'Handwashing', icon: 'hand-left', color: '#f97316' },
  },
  {
    pattern: /temperature|hot storage|cold storage|refrigerat|cooling|heating|reheating|thawing|cooking potentially|time as a public health/i,
    category: { key: 'temperature', label: 'Temperature', icon: 'thermometer', color: '#ef4444' },
  },
  {
    pattern: /clean-in-place|cleaning frequency|cleaning and maintenance|sanitiz|surfaces? ?-? ?clean/i,
    category: { key: 'cleanliness', label: 'Cleanliness', icon: 'brush', color: '#f97316' },
  },
  {
    pattern: /contamina|food protection|food display|food source|food supplies|date marking|dating and disposition/i,
    category: { key: 'contamination', label: 'Contamination', icon: 'warning', color: '#ef4444' },
  },
  {
    pattern: /poison|toxic/i,
    category: { key: 'chemicals', label: 'Chemicals', icon: 'flask', color: '#ef4444' },
  },
  {
    pattern: /plumbing|backflow|water supply|sewage/i,
    category: { key: 'plumbing', label: 'Plumbing', icon: 'water', color: '#3b82f6' },
  },
  {
    pattern: /employee|person in charge|knowledge|manager cert/i,
    category: { key: 'personnel', label: 'Personnel', icon: 'person', color: '#8b5cf6' },
  },
  {
    pattern: /floor|wall|ceiling|ventilation|lighting|premises|toilet|locker|linen/i,
    category: { key: 'facility', label: 'Facility', icon: 'business', color: '#6b7280' },
  },
  {
    pattern: /equipment|utensil|design and construction|single-service|surfaces? ?-? ?design|\bdesign\b/i,
    category: { key: 'equipment', label: 'Equipment', icon: 'construct', color: '#6b7280' },
  },
  {
    pattern: /storage|refuse|recyclable/i,
    category: { key: 'storage', label: 'Storage', icon: 'cube', color: '#6b7280' },
  },
];

const FALLBACK_CATEGORY: ViolationCategory = {
  key: 'other',
  label: 'Other',
  icon: 'alert-circle',
  color: '#9ca3af',
};

export function categorizeViolation(description: string): ViolationCategory {
  if (isPestEvidence(description)) return PESTS_CATEGORY;
  // Match the citation's code title first (before the "—"/"(N pts):" detail) —
  // it's authoritative; detail text mentions locations incidentally.
  const title = description.split(/—|\(\d+ ?pts?\):/)[0];
  for (const { pattern, category } of CATEGORY_MATCHERS) {
    if (pattern.test(title)) return category;
  }
  for (const { pattern, category } of CATEGORY_MATCHERS) {
    if (pattern.test(description)) return category;
  }
  return FALLBACK_CATEGORY;
}

/** Deduplicate categories from a list of violation descriptions */
export function getUniqueCategories(
  descriptions: string[]
): ViolationCategory[] {
  const seen = new Set<string>();
  const categories: ViolationCategory[] = [];

  for (const desc of descriptions) {
    const cat = categorizeViolation(desc);
    if (!seen.has(cat.key)) {
      seen.add(cat.key);
      categories.push(cat);
    }
  }

  return categories;
}
