import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface FeedSectionProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  accent: string;
  isLoading?: boolean;
  onSeeAll?: () => void;
  children: React.ReactNode;
}

export function FeedSection({
  icon,
  title,
  subtitle,
  accent,
  isLoading,
  onSeeAll,
  children,
}: FeedSectionProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <View style={styles.section}>
      {/* Header — tapping anywhere toggles collapsed */}
      <Pressable
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
        onPress={() => setCollapsed((c) => !c)}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${collapsed ? 'collapsed' : 'expanded'}`}
      >
        <View style={[styles.iconWrap, { backgroundColor: accent + '18' }]}>
          <Ionicons name={icon} size={18} color={accent} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: accent }]}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Ionicons
          name={collapsed ? 'chevron-forward' : 'chevron-down'}
          size={16}
          color="#94a3b8"
        />
      </Pressable>

      {/* Content — hidden when collapsed */}
      {!collapsed && (
        <>
          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={accent} />
            </View>
          ) : (
            <View style={styles.content}>{children}</View>
          )}

          {/* See All */}
          {onSeeAll && !isLoading && (
            <Pressable
              style={({ pressed }) => [
                styles.seeAll,
                pressed && styles.seeAllPressed,
              ]}
              onPress={onSeeAll}
            >
              <Text style={[styles.seeAllText, { color: accent }]}>See All</Text>
              <Ionicons name="chevron-forward" size={14} color={accent} />
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 4,
  },
  headerPressed: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '400',
    marginTop: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
    marginHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  seeAllPressed: {
    backgroundColor: '#f1f5f9',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
