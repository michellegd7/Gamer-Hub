import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

type Props = {
  station: any;
  onPress?: () => void;
};

export default function StationCard({
  station,
  onPress,
}: Props) {
  const available = station.status === 'AVAILABLE';
  const statusColor = available ? '#48D597' : station.status === 'MAINTENANCE' ? '#FFC56E' : '#FF7893';

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.image}>
        <Ionicons
          name={['PlayStation', 'Xbox'].includes(station.station_type) ? 'game-controller-outline' : 'desktop-outline'}
          size={34}
          color={available ? COLORS.cyan : COLORS.muted}
        />
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{station.name}</Text>
        <Text style={styles.detail}>{station.gpu}</Text>
        <Text style={styles.detail}>
          ₱ {station.rate} / hr
        </Text>
      </View>

      <View
        style={[
          styles.badge,
          {
          backgroundColor: `${statusColor}22`,
          },
        ]}
      >
        <Text style={styles.badgeText}>
          {station.status === 'AVAILABLE' ? 'AVAILABLE' : station.status}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 62,
    height: 58,
    borderRadius: 11,
    backgroundColor: '#24243A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    paddingHorizontal: 10,
  },
  name: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  detail: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 7,
    fontWeight: '700',
  },
});
