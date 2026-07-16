import { StyleSheet, View, Text, ScrollView, Linking, Pressable, Image } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import { WEB_BASE_URL, SUPPORT_EMAIL } from '../../constants/links';

export default function AboutScreen() {
  const { data: lastUpdated } = useDataFreshness();

  return (
    <ScrollView style={styles.container}>
      {/* App Header */}
      <View style={styles.appHeader}>
        <Image source={require('../../assets/icon.png')} style={styles.iconContainer} />
        <Text style={styles.appTitle}>DineSafeSD</Text>
        <Text style={styles.appVersion}>v1.0.0</Text>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.bodyText}>
          DineSafeSD lets you browse restaurant health inspection results across
          South Dakota. Search by name or location, view scores, and read
          detailed inspection reports — all in one place.
        </Text>
      </View>

      {/* Data Source Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Source</Text>
        <Text style={styles.bodyText}>
          Inspection data is public record, sourced from the South Dakota
          Department of Health (covering all 66 counties) and the City of
          Sioux Falls Health Department&apos;s SWEEPS program. Data is
          refreshed daily.
        </Text>
        {lastUpdated && (
          <Text style={styles.freshness}>
            Data updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </Text>
        )}
      </View>

      {/* Legal & Support */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal &amp; Support</Text>
        <Pressable onPress={() => Linking.openURL(`${WEB_BASE_URL}/privacy`)}>
          <Text style={styles.link}>Privacy Policy</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(`${WEB_BASE_URL}/terms`)}>
          <Text style={styles.link}>Terms of Use</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <Text style={styles.link}>Contact Support</Text>
        </Pressable>
      </View>

      {/* Score Guide Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Score Guide</Text>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreDot, { backgroundColor: '#15803d' }]} />
          <Text style={styles.scoreLabel}>
            <Text style={styles.scoreRange}>96–100</Text>
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreDot, { backgroundColor: '#4ade80' }]} />
          <Text style={styles.scoreLabel}>
            <Text style={styles.scoreRange}>90–95</Text>
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreDot, { backgroundColor: '#facc15' }]} />
          <Text style={styles.scoreLabel}>
            <Text style={styles.scoreRange}>83–89</Text>
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreDot, { backgroundColor: '#f97316' }]} />
          <Text style={styles.scoreLabel}>
            <Text style={styles.scoreRange}>76–82</Text>
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreDot, { backgroundColor: '#dc2626' }]} />
          <Text style={styles.scoreLabel}>
            <Text style={styles.scoreRange}>Below 76</Text>
          </Text>
        </View>
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This app is for informational purposes only. Inspection results are a
          snapshot in time and violations may have been corrected on-site.
          Always use your own judgment when choosing where to eat.
        </Text>
      </View>

      {/* Build info */}
      <View style={styles.buildInfo}>
        <Text style={styles.buildText}>DineSafeSD v1.0.0 (1)</Text>
        <Text style={styles.buildText}>Built with Expo + React Native</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafaf9',
  },
  appHeader: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 26,
    backgroundColor: '#15803d',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  appTitle: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.8,
  },
  appVersion: {
    marginTop: 4,
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  section: {
    marginTop: 24,
    backgroundColor: '#fff',
    marginHorizontal: 14,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 23,
    fontWeight: '400',
  },
  link: {
    marginTop: 10,
    fontSize: 15,
    color: '#15803d',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  freshness: {
    marginTop: 10,
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  scoreDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  scoreLabel: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '400',
  },
  scoreRange: {
    fontWeight: '700',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  disclaimer: {
    padding: 20,
    marginTop: 24,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '400',
  },
  buildInfo: {
    alignItems: 'center',
    paddingBottom: 40,
    gap: 2,
  },
  buildText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '400',
  },
});
