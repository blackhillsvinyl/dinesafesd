import { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import type { FilterState } from '../../types';
import { DEFAULT_FILTERS } from '../../hooks/useFilteredRestaurants';
import { VIOLATION_CATEGORIES } from '../map/violationCategoryList';

interface FilterSheetProps {
  bottomSheetRef: React.RefObject<BottomSheet | null>;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function FilterSheet({
  bottomSheetRef,
  filters,
  onFiltersChange,
}: FilterSheetProps) {
  const [localFilters, setLocalFilters] = useState(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleApply = useCallback(() => {
    onFiltersChange(localFilters);
    bottomSheetRef.current?.close();
  }, [localFilters, onFiltersChange, bottomSheetRef]);

  const handleReset = useCallback(() => {
    setLocalFilters(DEFAULT_FILTERS);
    onFiltersChange(DEFAULT_FILTERS);
  }, [onFiltersChange]);

  const toggleViolationType = useCallback((key: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      violationTypes: prev.violationTypes.includes(key)
        ? prev.violationTypes.filter((t) => t !== key)
        : [...prev.violationTypes, key],
    }));
  }, []);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={['75%']}
      enablePanDownToClose
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <BottomSheetScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Filters</Text>
          <Pressable onPress={handleReset}>
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
        </View>

        {/* Minimum Score */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Minimum Score</Text>
            <Text style={styles.sectionValue}>
              {localFilters.minScore === 0 ? 'Any' : `${localFilters.minScore}+`}
            </Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={localFilters.minScore}
            onValueChange={(value) =>
              setLocalFilters((prev) => ({ ...prev, minScore: value }))
            }
            minimumTrackTintColor="#22c55e"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#22c55e"
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>Any</Text>
            <Text style={styles.sliderLabel}>70</Text>
            <Text style={styles.sliderLabel}>90</Text>
            <Text style={styles.sliderLabel}>100</Text>
          </View>
        </View>

        {/* Max Distance */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Distance</Text>
            <Text style={styles.sectionValue}>
              {localFilters.maxDistance} miles
            </Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={localFilters.maxDistance}
            onValueChange={(value) =>
              setLocalFilters((prev) => ({ ...prev, maxDistance: value }))
            }
            minimumTrackTintColor="#22c55e"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#22c55e"
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1 mi</Text>
            <Text style={styles.sliderLabel}>15 mi</Text>
            <Text style={styles.sliderLabel}>30 mi</Text>
            <Text style={styles.sliderLabel}>50 mi</Text>
          </View>
        </View>

        {/* Recent Only */}
        <Pressable
          style={styles.toggleRow}
          onPress={() =>
            setLocalFilters((prev) => ({
              ...prev,
              recentOnly: !prev.recentOnly,
            }))
          }
        >
          <View style={styles.toggleInfo}>
            <Ionicons name="calendar-outline" size={24} color="#374151" />
            <View>
              <Text style={styles.toggleTitle}>Recently Inspected</Text>
              <Text style={styles.toggleSubtitle}>
                Only show inspections from last 90 days
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.toggle,
              localFilters.recentOnly && styles.toggleActive,
            ]}
          >
            {localFilters.recentOnly && (
              <Ionicons name="checkmark" size={16} color="#fff" />
            )}
          </View>
        </Pressable>

        {/* Violation Severity */}
        <View style={styles.violationSection}>
          <Text style={styles.sectionTitle}>Violation Severity</Text>
          <Text style={styles.sectionSubtitle}>
            Hide restaurants with critical violations
          </Text>
          <Pressable
            style={styles.toggleRow}
            onPress={() =>
              setLocalFilters((prev) => ({
                ...prev,
                hideCritical: !prev.hideCritical,
              }))
            }
          >
            <View style={styles.toggleInfo}>
              <View style={styles.criticalDot} />
              <Text style={styles.toggleTitle}>Critical violations</Text>
            </View>
            <View
              style={[
                styles.toggle,
                localFilters.hideCritical && styles.toggleCriticalActive,
              ]}
            >
              {localFilters.hideCritical && (
                <Ionicons name="checkmark" size={16} color="#fff" />
              )}
            </View>
          </Pressable>
        </View>

        {/* Violation Types */}
        <View style={styles.violationSection}>
          <Text style={styles.sectionTitle}>Exclude Violation Types</Text>
          <Text style={styles.sectionSubtitle}>
            Hide restaurants with these types of violations
          </Text>
          <View style={styles.categoryGrid}>
            {VIOLATION_CATEGORIES.map((cat) => {
              const isExcluded = localFilters.violationTypes.includes(cat.key);
              return (
                <Pressable
                  key={cat.key}
                  style={[
                    styles.categoryChip,
                    isExcluded && styles.categoryChipActive,
                  ]}
                  onPress={() => toggleViolationType(cat.key)}
                >
                  <Ionicons
                    name={cat.icon}
                    size={14}
                    color={isExcluded ? '#991b1b' : '#475569'}
                  />
                  <Text
                    style={[
                      styles.categoryChipText,
                      isExcluded && styles.categoryChipTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Apply Button */}
        <Pressable style={styles.applyButton} onPress={handleApply}>
          <Text style={styles.applyButtonText}>Apply Filters</Text>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#fff',
    borderRadius: 24,
  },
  indicator: {
    backgroundColor: '#d1d5db',
    width: 40,
  },
  container: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  resetText: {
    fontSize: 15,
    color: '#22c55e',
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    marginBottom: 12,
  },
  sectionValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#22c55e',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  toggleSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  toggle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  toggleCriticalActive: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  criticalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  violationSection: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 20,
    marginBottom: 20,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChipActive: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#991b1b',
  },
  applyButton: {
    backgroundColor: '#22c55e',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
