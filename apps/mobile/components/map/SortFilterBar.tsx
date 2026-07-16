import { useState, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FilterState, SortOption } from '../../types';
import { VIOLATION_CATEGORIES } from './violationCategoryList';

const SORT_LABELS: Record<SortOption, string> = {
  score: 'Score ↓',
  distance: 'Distance',
  recent: 'Recent',
};

interface SortFilterBarProps {
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}

export function SortFilterBar({
  sort,
  onSortChange,
  filters,
  onFiltersChange,
  onOpenFilters,
  activeFilterCount,
}: SortFilterBarProps) {
  const [showSortPicker, setShowSortPicker] = useState(false);

  const handleSortSelect = useCallback(
    (option: SortOption) => {
      onSortChange(option);
      setShowSortPicker(false);
    },
    [onSortChange]
  );

  const removeFilter = useCallback(
    (key: string, value?: string) => {
      const next = { ...filters };
      switch (key) {
        case 'minScore':
          next.minScore = 0;
          break;
        case 'maxDistance':
          next.maxDistance = 50;
          break;
        case 'recentOnly':
          next.recentOnly = false;
          break;
        case 'hideCritical':
          next.hideCritical = false;
          break;
        case 'violationType':
          next.violationTypes = next.violationTypes.filter((t) => t !== value);
          break;
      }
      onFiltersChange(next);
    },
    [filters, onFiltersChange]
  );

  const chips: { label: string; key: string; value?: string }[] = [];
  if (filters.minScore > 0) chips.push({ label: `Score ${filters.minScore}+`, key: 'minScore' });
  if (filters.maxDistance < 50) chips.push({ label: `Within ${filters.maxDistance} mi`, key: 'maxDistance' });
  if (filters.recentOnly) chips.push({ label: 'Last 90 days', key: 'recentOnly' });
  if (filters.hideCritical) chips.push({ label: 'No Critical', key: 'hideCritical' });
  for (const vt of filters.violationTypes) {
    const cat = VIOLATION_CATEGORIES.find((c) => c.key === vt);
    chips.push({ label: cat?.label ?? vt, key: 'violationType', value: vt });
  }

  return (
    <View>
      {/* Controls row */}
      <View style={styles.row}>
        {/* Sort dropdown */}
        <Pressable style={styles.sortBtn} onPress={() => setShowSortPicker(true)}>
          <Ionicons name="swap-vertical" size={13} color="#94a3b8" />
          <Text style={styles.sortLabel}>{SORT_LABELS[sort]}</Text>
        </Pressable>

        {/* Filter button */}
        <Pressable style={styles.filterBtn} onPress={onOpenFilters}>
          <Ionicons name="options-outline" size={13} color="#94a3b8" />
          <Text style={styles.filterLabel}>Filter</Text>
          {activeFilterCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Pressable
              key={chip.key + (chip.value ?? '')}
              style={styles.chip}
              onPress={() => removeFilter(chip.key, chip.value)}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
              <Ionicons name="close" size={11} color="#94a3b8" />
            </Pressable>
          ))}
        </View>
      )}

      {/* Sort picker overlay */}
      <Modal
        visible={showSortPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSortPicker(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowSortPicker(false)}>
          <View style={styles.picker}>
            <Text style={styles.pickerTitle}>Sort by</Text>
            {(['score', 'distance', 'recent'] as SortOption[]).map((opt) => (
              <Pressable
                key={opt}
                style={[styles.pickerItem, sort === opt && styles.pickerItemActive]}
                onPress={() => handleSortSelect(opt)}
              >
                <Text
                  style={[styles.pickerItemText, sort === opt && styles.pickerItemTextActive]}
                >
                  {SORT_LABELS[opt]}
                </Text>
                {sort === opt && <Ionicons name="checkmark" size={16} color="#15803d" />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  badge: {
    backgroundColor: '#15803d',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginLeft: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  picker: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 8,
    width: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    letterSpacing: -0.2,
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pickerItemActive: {
    backgroundColor: '#f0fdf4',
  },
  pickerItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
  },
  pickerItemTextActive: {
    fontWeight: '700',
    color: '#15803d',
  },
});
