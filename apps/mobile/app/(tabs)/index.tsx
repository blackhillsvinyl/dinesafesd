import { useState, useRef, useCallback, useEffect, Component, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// MapLibre is a native module — wrap in error boundary for Expo Go
let MapLibreGL: any;
let CameraRefType: any;
try {
  MapLibreGL = require('@maplibre/maplibre-react-native').default;
  CameraRefType = require('@maplibre/maplibre-react-native').CameraRef;
} catch {
  MapLibreGL = null;
}
type CameraRef = any;
import * as Location from 'expo-location';
import { router } from 'expo-router';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import {
  useRestaurantsNearby,
  useSearchRestaurants,
  useLatestViolations,
} from '../../hooks/useRestaurants';
import { RestaurantCard } from '../../components/restaurant/RestaurantCard';
import RestaurantQuickView from '../../components/map/RestaurantQuickView';
import type { Restaurant } from '../../types';
import { useFilteredRestaurants, DEFAULT_FILTERS } from '../../hooks/useFilteredRestaurants';
import { SortFilterBar } from '../../components/map/SortFilterBar';
import { FilterSheet } from '../../components/search/FilterSheet';
import type { FilterState, SortOption } from '../../types';
import { getMarkerColor, isPerfectScore } from '../../utils/scoring';

if (MapLibreGL) MapLibreGL.setAccessToken(null);
const MAP_AVAILABLE = !!MapLibreGL;

async function geocodePlace(
  query: string
): Promise<{ name: string; lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'DineSafeSD/1.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return {
      name: data[0].display_name?.split(',').slice(0, 2).join(',') ?? query,
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
    };
  } catch {
    return null;
  }
}

// Center of South Dakota
const DEFAULT_CENTER: [number, number] = [-100.3, 44.4];
const DEFAULT_ZOOM = 6;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [query, setQuery] = useState('');
  const [placeResult, setPlaceResult] = useState<{
    name: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortOption>('distance');
  const filterSheetRef = useRef<BottomSheet>(null);

  const [radiusMiles, setRadiusMiles] = useState(250);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const isAnimatingRef = useRef(false);

  const { data: nearbyRestaurants, isLoading: isLoadingNearby } =
    useRestaurantsNearby(center[1], center[0], radiusMiles);
  const { data: searchResults, isLoading: isLoadingSearch } =
    useSearchRestaurants(debouncedQuery);
  const { data: violations, isLoading: isLoadingViolations } =
    useLatestViolations(selectedRestaurant?.id ?? null);

  const { data: filteredNearby, count: filteredCount, activeFilterCount } =
    useFilteredRestaurants(nearbyRestaurants, filters, sort);

  const displayed = isSearching ? searchResults : filteredNearby;
  const loading = isSearching ? isLoadingSearch : isLoadingNearby;
  const count = isSearching ? (searchResults?.length ?? 0) : filteredCount;
  // Limit markers on map for performance — show all in the list
  // Limit markers based on zoom level to prevent overlap
  const markerLimit = zoomLevel >= 14 ? 200 : zoomLevel >= 12 ? 100 : zoomLevel >= 10 ? 50 : 25;
  const mapMarkers = displayed?.slice(0, markerLimit) ?? [];

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(c);
      // SD + WY bounding box
      if (c.latitude > 41 && c.latitude < 46 && c.longitude > -111.5 && c.longitude < -96.5) {
        setCenter([c.longitude, c.latitude]);
        cameraRef.current?.setCamera({
          centerCoordinate: [c.longitude, c.latitude],
          zoomLevel: 10,
          animationDuration: 1000,
        });
      }
    })();
  }, []);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    setSelectedRestaurant(null);
    setPlaceResult(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length >= 2) {
      setIsSearching(true);
      debounceRef.current = setTimeout(() => {
        setDebouncedQuery(text);
        // Also geocode the search text for place results
        geocodePlace(text).then((place) => setPlaceResult(place));
      }, 400);
    } else {
      setIsSearching(false);
      setDebouncedQuery('');
    }
  }, []);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setIsSearching(false);
    setPlaceResult(null);
    Keyboard.dismiss();
  }, []);

  const handlePlaceSelect = useCallback((place: { name: string; lat: number; lng: number }) => {
    setCenter([place.lng, place.lat]);
    if (MAP_AVAILABLE) {
      cameraRef.current?.setCamera({
        centerCoordinate: [place.lng, place.lat],
        zoomLevel: 12,
        animationDuration: 800,
      });
    }
    clearSearch();
  }, [clearSearch]);

  const handleSearchFocus = useCallback(() => {
    setSelectedRestaurant(null);
    bottomSheetRef.current?.snapToIndex(2);
  }, []);

  const handleMarkerPress = useCallback((r: Restaurant) => {
    setSelectedRestaurant(r);
    Keyboard.dismiss();
    bottomSheetRef.current?.snapToIndex(0);
    // Center on restaurant without changing zoom level
    isAnimatingRef.current = true;
    cameraRef.current?.setCamera({
      centerCoordinate: [r.longitude, r.latitude],
      animationDuration: 400,
    });
    setTimeout(() => { isAnimatingRef.current = false; }, 500);
  }, []);

  const handleDetails = useCallback((r: Restaurant) => {
    router.push(`/restaurant/${r.id}`);
  }, []);

  const handleShowOnMap = useCallback((r: Restaurant) => {
    if (r.latitude && r.longitude) {
      isAnimatingRef.current = true;
      cameraRef.current?.setCamera({
        centerCoordinate: [r.longitude, r.latitude],
        zoomLevel: 15,
        animationDuration: 800,
      });
      setCenter([r.longitude, r.latitude]);
      setTimeout(() => { isAnimatingRef.current = false; }, 900);
    }
    clearSearch();
    setSelectedRestaurant(r);
    bottomSheetRef.current?.snapToIndex(0);
  }, [clearSearch]);

  const handleCenterOnUser = useCallback(() => {
    if (userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate: [userLocation.longitude, userLocation.latitude],
        zoomLevel: 12,
        animationDuration: 500,
      });
      setCenter([userLocation.longitude, userLocation.latitude]);
    }
  }, [userLocation]);

  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(zoomLevel + 1.5, 18);
    isAnimatingRef.current = true;
    cameraRef.current?.setCamera({
      zoomLevel: newZoom,
      animationDuration: 300,
    });
    setZoomLevel(newZoom);
    setTimeout(() => { isAnimatingRef.current = false; }, 400);
  }, [zoomLevel]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(zoomLevel - 1.5, 3);
    isAnimatingRef.current = true;
    cameraRef.current?.setCamera({
      zoomLevel: newZoom,
      animationDuration: 300,
    });
    setZoomLevel(newZoom);
    setTimeout(() => { isAnimatingRef.current = false; }, 400);
  }, [zoomLevel]);

  const handleOpenFilters = useCallback(() => {
    filterSheetRef.current?.snapToIndex(0);
  }, []);

  const handleSheetAnimate = useCallback((fromIndex: number, toIndex: number) => {
    // Dismiss quick-view as soon as the sheet starts expanding
    if (toIndex > 0) {
      setSelectedRestaurant(null);
    }
  }, []);


  const renderItem = useCallback(
    ({ item }: { item: Restaurant }) => (
      <RestaurantCard
        restaurant={item}
        onPress={() => handleDetails(item)}
        onShowOnMap={() => handleShowOnMap(item)}
      />
    ),
    [handleDetails, handleShowOnMap]
  );

  return (
    <View style={styles.root}>
      {MAP_AVAILABLE ? (
        <MapLibreGL.MapView
          style={styles.map}
          mapStyle="https://tiles.openfreemap.org/styles/liberty"
          logoEnabled={false}
          attributionEnabled={true}
          attributionPosition={{ bottom: 8, left: 8 }}
          onPress={() => setSelectedRestaurant(null)}
          onRegionDidChange={(e: any) => {
            // Skip region change events triggered by programmatic camera moves
            if (isAnimatingRef.current) return;
            if (mapDebounceRef.current) clearTimeout(mapDebounceRef.current);
            mapDebounceRef.current = setTimeout(() => {
              if (e?.geometry?.coordinates) {
                const [lng, lat] = e.geometry.coordinates;
                setCenter([lng, lat]);
              }
              const zoom = e?.properties?.zoomLevel ?? DEFAULT_ZOOM;
              setZoomLevel(zoom);
              if (zoom >= 12) setRadiusMiles(15);
              else if (zoom >= 10) setRadiusMiles(30);
              else if (zoom >= 8) setRadiusMiles(75);
              else if (zoom >= 6) setRadiusMiles(200);
              else setRadiusMiles(400);
            }, 500);
          }}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
          />
          <MapLibreGL.UserLocation visible={true} />
          {mapMarkers.map((r: any) => (
            <MapLibreGL.MarkerView
              key={r.id}
              coordinate={[r.longitude, r.latitude]}
            >
              <Pressable
                onPress={() => handleMarkerPress(r)}
                style={[
                  styles.pin,
                  { backgroundColor: getMarkerColor(r.latest_score ?? null) },
                  selectedRestaurant?.id === r.id && styles.pinActive,
                ]}
              >
                <Text style={styles.pinText}>
                  {r.latest_score ?? '?'}
                  {isPerfectScore(r.latest_score ?? null) ? ' \u2605' : ''}
                </Text>
              </Pressable>
            </MapLibreGL.MarkerView>
          ))}
        </MapLibreGL.MapView>
      ) : (
        <View style={[styles.map, { justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="map-outline" size={48} color="#64748b" />
          <Text style={{ color: '#94a3b8', fontSize: 14, marginTop: 8, fontWeight: '600' }}>
            Map requires a native build
          </Text>
          <Text style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {loading ? 'Loading...' : `${count} restaurants nearby`}
          </Text>
        </View>
      )}

      {/* Search */}
      <View style={[styles.searchWrap, { top: insets.top + 10 }]}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants or places"
            placeholderTextColor="#94a3b8"
            value={query}
            onChangeText={handleSearch}
            onFocus={handleSearchFocus}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Map controls */}
      {MAP_AVAILABLE && (
        <View style={[styles.mapControls, { top: insets.top + 10 }]}>
          {userLocation && (
            <Pressable style={styles.mapControlBtn} onPress={handleCenterOnUser}>
              <Ionicons name="locate" size={20} color="#0f172a" />
            </Pressable>
          )}
          <Pressable style={styles.mapControlBtn} onPress={handleZoomIn}>
            <Ionicons name="add" size={22} color="#0f172a" />
          </Pressable>
          <Pressable style={styles.mapControlBtn} onPress={handleZoomOut}>
            <Ionicons name="remove" size={22} color="#0f172a" />
          </Pressable>
        </View>
      )}

      {/* Quick view */}
      {selectedRestaurant && (
        <View style={styles.quickWrap}>
          <RestaurantQuickView
            name={selectedRestaurant.name}
            address={selectedRestaurant.address}
            city={selectedRestaurant.city}
            score={selectedRestaurant.latest_score ?? null}
            inspectionDate={selectedRestaurant.latest_inspection_date ?? null}
            scoreHistory={selectedRestaurant.score_history}
            scoreTrend={selectedRestaurant.score_trend}
            violationHistory={selectedRestaurant.violation_history}
            violationTrend={selectedRestaurant.violation_trend}
            violations={violations ?? null}
            isLoading={isLoadingViolations}
            onViewDetails={() => router.push(`/restaurant/${selectedRestaurant.id}`)}
            onClose={() => setSelectedRestaurant(null)}
          />
        </View>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={['14%', '50%', '90%']}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        onAnimate={handleSheetAnimate}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {isSearching ? 'Search Results' : 'Nearby'}
          </Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {loading ? '…' : count}
            </Text>
          </View>
        </View>
        {!isSearching && (
          <SortFilterBar
            sort={sort}
            onSortChange={setSort}
            filters={filters}
            onFiltersChange={setFilters}
            onOpenFilters={handleOpenFilters}
            activeFilterCount={activeFilterCount}
          />
        )}
        {isSearching && placeResult && (
          <Pressable
            onPress={() => handlePlaceSelect(placeResult)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginHorizontal: 14,
              marginBottom: 8,
              padding: 12,
              backgroundColor: '#0f172a',
              borderRadius: 10,
              gap: 10,
            }}
          >
            <Ionicons name="location" size={18} color="#22c55e" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                Go to {placeResult.name}
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                Search restaurants in this area
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color="#64748b" />
          </Pressable>
        )}
        <BottomSheetFlatList
          data={displayed ?? []}
          keyExtractor={(item: Restaurant) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons
                  name={isSearching ? 'search-outline' : 'restaurant-outline'}
                  size={36}
                  color="#cbd5e1"
                />
                <Text style={styles.emptyTitle}>
                  {isSearching ? 'No matches' : 'No restaurants nearby'}
                </Text>
                <Text style={styles.emptySub}>
                  {isSearching
                    ? 'Try a different name or city'
                    : 'Zoom into an area to see results'}
                </Text>
              </View>
            ) : null
          }
        />
      </BottomSheet>
      <FilterSheet
        bottomSheetRef={filterSheetRef}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  map: { flex: 1 },

  // Search
  searchWrap: {
    position: 'absolute',
    left: 14,
    right: 56,
    zIndex: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
    height: '100%',
    letterSpacing: -0.2,
  },

  // Map controls
  mapControls: {
    position: 'absolute',
    right: 14,
    gap: 8,
    zIndex: 10,
  },
  mapControlBtn: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 12,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  } as const,

  // Pins
  pin: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  pinActive: {
    transform: [{ scale: 1.3 }],
    borderColor: '#fff',
    borderWidth: 2.5,
    shadowOpacity: 0.5,
  },
  pinText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  // Quick view
  quickWrap: {
    position: 'absolute',
    bottom: 130,
    left: 14,
    right: 14,
    zIndex: 20,
  },

  // Bottom sheet
  sheetBg: {
    backgroundColor: 'rgba(248,250,252,0.96)',
    borderRadius: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  sheetHandle: {
    backgroundColor: '#94a3b8',
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 8,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 20,
  },

  // Empty
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#94a3b8',
    marginTop: 4,
  },
  emptySub: {
    fontSize: 13,
    color: '#cbd5e1',
  },
});
