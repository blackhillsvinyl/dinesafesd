import { View, Text, StyleSheet } from 'react-native';

interface ScoreMarkerProps {
  score: number | null;
  color: string;
}

export function ScoreMarker({ score, color }: ScoreMarkerProps) {
  return (
    <View style={[styles.container, { backgroundColor: color }]}>
      <Text style={styles.score}>{score ?? '?'}</Text>
      <View style={[styles.pointer, { borderTopColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 36,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  score: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pointer: {
    position: 'absolute',
    bottom: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
