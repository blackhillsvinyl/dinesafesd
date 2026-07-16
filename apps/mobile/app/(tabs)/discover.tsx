import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCodeRedRestaurants,
  useSpotlightRestaurants,
  useRecentInspections,
  useWatchListRestaurants,
  usePestAlerts,
  useTemperatureViolations,
  usePerfectRecord,
  useHandwashingIssues,
  useMostInspected,
} from '../../hooks/useRestaurants';
import { FeedCard } from '../../components/feed/FeedCard';
import { FeedSection } from '../../components/feed/FeedSection';
import { isPerfectScore } from '../../utils/scoring';

const COLORS = {
  codeRed: '#dc2626',
  spotlight: '#15803d',
  recent: '#64748b',
  watchList: '#ea580c',
  pest: '#7c2d12',
  temperature: '#0369a1',
  perfect: '#059669',
  handwashing: '#6d28d9',
  inspected: '#475569',
};

function daysAgo(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const codeRed = useCodeRedRestaurants();
  const spotlight = useSpotlightRestaurants();
  const recent = useRecentInspections();
  const watchList = useWatchListRestaurants();
  const pestAlerts = usePestAlerts();
  const tempViolations = useTemperatureViolations();
  const perfectRecord = usePerfectRecord();
  const handwashing = useHandwashingIssues();
  const mostInspected = useMostInspected();

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Discover</Text>
          <Text style={styles.pageSubtitle}>South Dakota food safety intelligence</Text>
        </View>

        {/* Code Red */}
        <FeedSection
          icon="alert-circle"
          title="Code Red"
          subtitle="Recent critical violations"
          accent={COLORS.codeRed}
          isLoading={codeRed.isLoading}
        >
          {codeRed.data?.length === 0 && (
            <Text style={styles.emptyText}>No critical violations in the last 90 days</Text>
          )}
          {codeRed.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.codeRed}
              meta={`Critical violations · ${daysAgo(r.latest_inspection_date ?? null)}d ago`}
            />
          ))}
        </FeedSection>

        {/* Pest Alerts */}
        <FeedSection
          icon="bug"
          title="Pest Alerts"
          subtitle="Rodent, insect, or pest violations"
          accent={COLORS.pest}
          isLoading={pestAlerts.isLoading}
        >
          {pestAlerts.data?.length === 0 && (
            <Text style={styles.emptyText}>No pest violations found</Text>
          )}
          {pestAlerts.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.pest}
              meta={`Pest violation · ${daysAgo(r.latest_inspection_date ?? null)}d ago`}
            />
          ))}
        </FeedSection>

        {/* Temperature Trouble */}
        <FeedSection
          icon="thermometer"
          title="Temperature Trouble"
          subtitle="Cold/hot holding failures"
          accent={COLORS.temperature}
          isLoading={tempViolations.isLoading}
        >
          {tempViolations.data?.length === 0 && (
            <Text style={styles.emptyText}>No temperature violations found</Text>
          )}
          {tempViolations.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.temperature}
              meta={`Temp violation · ${daysAgo(r.latest_inspection_date ?? null)}d ago`}
            />
          ))}
        </FeedSection>

        {/* Handwashing Issues */}
        <FeedSection
          icon="hand-left"
          title="Handwashing"
          subtitle="Handwashing violations flagged"
          accent={COLORS.handwashing}
          isLoading={handwashing.isLoading}
        >
          {handwashing.data?.length === 0 && (
            <Text style={styles.emptyText}>No handwashing violations found</Text>
          )}
          {handwashing.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.handwashing}
              meta={`Handwashing issue · ${daysAgo(r.latest_inspection_date ?? null)}d ago`}
            />
          ))}
        </FeedSection>

        {/* Perfect Record */}
        <FeedSection
          icon="shield-checkmark"
          title="Perfect Record"
          subtitle="Score 100, zero violations"
          accent={COLORS.perfect}
          isLoading={perfectRecord.isLoading}
        >
          {perfectRecord.data?.length === 0 && (
            <Text style={styles.emptyText}>No perfect records found</Text>
          )}
          {perfectRecord.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.perfect}
              meta="★ Flawless inspection"
            />
          ))}
        </FeedSection>

        {/* Spotlight */}
        <FeedSection
          icon="star"
          title="Spotlight"
          subtitle="Consistently excellent (98+)"
          accent={COLORS.spotlight}
          isLoading={spotlight.isLoading}
        >
          {spotlight.data?.length === 0 && (
            <Text style={styles.emptyText}>No spotlight restaurants found</Text>
          )}
          {spotlight.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.spotlight}
              meta={isPerfectScore(r.latest_score ?? null) ? '★ Perfect score' : undefined}
            />
          ))}
        </FeedSection>

        {/* Recently Inspected */}
        <FeedSection
          icon="time"
          title="Just Inspected"
          subtitle="Fresh reports"
          accent={COLORS.recent}
          isLoading={recent.isLoading}
        >
          {recent.data?.length === 0 && (
            <Text style={styles.emptyText}>No recent inspections</Text>
          )}
          {recent.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              meta={`Inspected ${daysAgo(r.latest_inspection_date ?? null)}d ago`}
            />
          ))}
        </FeedSection>

        {/* Most Inspected */}
        <FeedSection
          icon="clipboard"
          title="Most Inspected"
          subtitle="Highest inspection frequency"
          accent={COLORS.inspected}
          isLoading={mostInspected.isLoading}
        >
          {mostInspected.data?.length === 0 && (
            <Text style={styles.emptyText}>No data available</Text>
          )}
          {mostInspected.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.inspected}
              meta={`${r.inspection_count} inspections on file`}
            />
          ))}
        </FeedSection>

        {/* Watch List */}
        <FeedSection
          icon="warning"
          title="Watch List"
          subtitle="Scores below 85"
          accent={COLORS.watchList}
          isLoading={watchList.isLoading}
        >
          {watchList.data?.length === 0 && (
            <Text style={styles.emptyText}>No restaurants on the watch list</Text>
          )}
          {watchList.data?.map((r) => (
            <FeedCard
              key={r.id}
              restaurant={r}
              accent={COLORS.watchList}
              meta={
                r.latest_score !== undefined && r.latest_score !== null
                  ? `Score: ${r.latest_score}`
                  : undefined
              }
            />
          ))}
        </FeedSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafaf9',
  },
  scroll: {
    paddingBottom: 24,
  },
  pageHeader: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.8,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '400',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 16,
    fontWeight: '400',
  },
});
