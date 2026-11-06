import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { fetchStations } from '../data/gamingHub';

export default function StationDetails() {
  const { id } = useLocalSearchParams();
  const [stationList, setStationList] = useState<Awaited<ReturnType<typeof fetchStations>>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let mounted = true;
    fetchStations().then(data => { if (mounted) { setStationList(data); setLoadError(''); } })
      .catch(error => { if (mounted) setLoadError(error instanceof Error ? error.message : 'Could not load this station from the live hub.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const station = stationList.find(item => item.id === id);

  if (loading) return <SafeAreaView style={styles.container}><View style={styles.content}><AppHeader title="STATION DETAILS" /><ActivityIndicator color={COLORS.primary} style={{ marginTop: 42 }} /></View></SafeAreaView>;
  if (loadError || !station) return <SafeAreaView style={styles.container}><View style={styles.content}><AppHeader title="STATION DETAILS" /><View style={styles.loadError}><Ionicons name="cloud-offline-outline" size={28} color="#FFC56E" /><Text style={styles.loadErrorTitle}>{loadError ? 'Live station unavailable' : 'Station not found'}</Text><Text style={styles.loadErrorText}>{loadError || 'This station is not in the connected GamerHub database. Return to Stations and refresh the live list.'}</Text></View><AppButton title="BACK TO STATIONS" onPress={() => router.replace('/stations')} style={styles.button} /></View></SafeAreaView>;

  const specs = [
    ['Processor', station.processor],
    ['GPU', station.gpu],
    ['RAM', station.ram],
    ['Monitor', station.monitor],
    ['Rate', `₱ ${station.rate} / hr`],
  ];
  const available = station.status === 'AVAILABLE';
  const bookable = station.status !== 'MAINTENANCE';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title={station.name} />

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, !available && styles.statusDotBusy]} />
          <Text style={[styles.performance, !available && styles.performanceBusy]}>
            {available ? 'AVAILABLE NOW' : station.status}
          </Text>
        </View>

        <View style={styles.hero}>
          <Ionicons
            name="desktop"
            size={100}
            color={COLORS.cyan}
          />
        </View>

        <View style={styles.specs}>
          {specs.map(([name, value]) => (
            <View style={styles.row} key={name}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>

        <AppButton
          title={available ? 'RESERVE THIS STATION' : bookable ? 'CHOOSE A FUTURE TIME' : 'FIND AN AVAILABLE STATION'}
          onPress={() => bookable
            ? router.push({ pathname: '/reservation', params: { id: station.id } })
            : router.replace('/stations')
          }
          style={styles.button}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  performance: {
    color: '#59E6AA',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusRow: {
    marginTop: -8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#59E6AA',
  },
  statusDotBusy: {
    backgroundColor: '#FF7893',
  },
  performanceBusy: {
    color: '#FF9AAE',
  },
  hero: {
    height: 190,
    backgroundColor: '#252039',
    marginTop: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specs: {
    marginTop: 35,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 13,
  },
  name: {
    color: COLORS.muted,
    fontSize: 11,
  },
  value: {
    color: COLORS.white,
    fontSize: 11,
  },
  button: {
    marginTop: 'auto',
    marginBottom: 30,
  },
  loadError: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 10 },
  loadErrorTitle: { color: COLORS.white, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  loadErrorText: { color: COLORS.muted, fontSize: 10, lineHeight: 16, textAlign: 'center' },
});
