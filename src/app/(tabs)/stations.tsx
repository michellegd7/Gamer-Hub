import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import AppHeader from '../../components/AppHeader';
import StationCard from '../../components/StationCard';
import { fetchStations } from '../../data/gamingHub';
import { supabase } from '../../lib/supabase';

const filters = ['All', 'Available', 'PC', 'Console', 'VIP'];

export default function Stations() {
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [sortByPrice, setSortByPrice] = useState(false);
  const [stationList, setStationList] = useState<Awaited<ReturnType<typeof fetchStations>>>([]);
  const [stationsError, setStationsError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    const refreshStations = () => {
      fetchStations().then(data => {
        if (!mounted) return;
        setStationList(data);
        setStationsError('');
      }).catch(error => {
        if (mounted) {
          setStationList([]);
          setStationsError(error instanceof Error ? error.message : 'Could not load live stations. Check your connection and try again.');
        }
      }).finally(() => {
        if (mounted) setLoading(false);
      });
    };
    refreshStations();
    const channel = supabase.channel('gamer-station-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stations' }, refreshStations)
      .subscribe();
    const timer = setInterval(refreshStations, 15000);
    return () => { mounted = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, []);
  const shown = useMemo(() => stationList.filter(station => {
    const matchesFilter = filter === 'All'
      || (filter === 'Available' && station.status === 'AVAILABLE')
      || (filter === 'PC' && station.station_type === 'PC')
      || (filter === 'Console' && ['PlayStation', 'Xbox'].includes(station.station_type))
      || (filter === 'VIP' && station.name.startsWith('VIP'));
    const search = query.trim().toLowerCase();
    return matchesFilter && (!search || `${station.name} ${station.gpu} ${station.processor}`.toLowerCase().includes(search));
  }).sort((first, second) => sortByPrice
    ? first.rate - second.rate
    : Number(second.status === 'AVAILABLE') - Number(first.status === 'AVAILABLE')),
  [filter, query, sortByPrice, stationList]);
  const availableCount = stationList.filter(station => station.status === 'AVAILABLE').length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="FIND YOUR STATION" />
        <View style={styles.intro}><Text style={styles.title}>Pick your setup</Text><Text style={styles.subtitle}>{stationsError || `${availableCount} of ${stationList.length} stations ready to play`}</Text></View>
        <View style={styles.search}><Ionicons name="search-outline" size={18} color={COLORS.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search station or graphics card" placeholderTextColor={COLORS.muted} style={styles.searchInput} returnKeyType="search" clearButtonMode="while-editing" /></View>
        <ScrollView horizontal style={styles.filterScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {filters.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Filter stations: ${item}`} accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.selected]}><Text style={[styles.filterText, filter === item && styles.selectedText]}>{item}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.results}><Text style={styles.resultsText}>{shown.length} {shown.length === 1 ? 'station' : 'stations'}</Text><Pressable accessibilityRole="button" onPress={() => setSortByPrice(value => !value)} style={styles.sortButton}><Ionicons name="swap-vertical" size={13} color="#C58AFF" /><Text style={styles.sortLabel}>Sort: {sortByPrice ? 'Lowest price' : 'Availability'}</Text></Pressable></View>
        <ScrollView style={styles.stationList} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} /> : stationsError ? <View style={styles.empty}><Ionicons name="cloud-offline-outline" size={28} color="#FFC56E" /><Text style={styles.emptyTitle}>Live stations unavailable</Text><Text style={styles.emptyText}>{stationsError}</Text><Pressable onPress={() => { setLoading(true); void fetchStations().then(data => { setStationList(data); setStationsError(''); }).catch(error => setStationsError(error instanceof Error ? error.message : 'Could not load live stations.')).finally(() => setLoading(false)); }}><Text style={styles.reset}>TRY AGAIN</Text></Pressable></View> : shown.length ? shown.map(station => <StationCard key={station.id} station={station} onPress={() => router.push({ pathname: '/station-details', params: { id: station.id } })} />) : <View style={styles.empty}><Ionicons name="search-outline" size={28} color={COLORS.muted} /><Text style={styles.emptyTitle}>No stations found</Text><Text style={styles.emptyText}>Try another name or filter.</Text><Pressable onPress={() => { setFilter('All'); setQuery(''); }}><Text style={styles.reset}>Clear search</Text></Pressable></View>}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, paddingHorizontal: 20 },
  intro: { marginTop: 7, marginBottom: 16 },
  title: { color: COLORS.white, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: COLORS.muted, fontSize: 11, marginTop: 5 },
  search: { height: 46, borderRadius: 13, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 9 },
  searchInput: { flex: 1, color: COLORS.white, fontSize: 11, paddingVertical: 0 },
  filterScroll: { height: 54, flexGrow: 0, flexShrink: 0, marginTop: 6, marginBottom: 4 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  filter: { backgroundColor: COLORS.surface, minHeight: 38, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: COLORS.border },
  selected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  selectedText: { color: COLORS.white },
  results: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  resultsText: { color: COLORS.white, fontWeight: '700', fontSize: 11 },
  stationList: { flex: 1 },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingLeft: 8 },
  sortLabel: { color: '#C58AFF', fontSize: 9, fontWeight: '700' },
  list: { paddingBottom: 18 },
  empty: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, padding: 28, marginTop: 15 },
  emptyTitle: { color: COLORS.white, fontSize: 13, fontWeight: '700', marginTop: 10 },
  emptyText: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  reset: { color: '#C58AFF', fontSize: 10, fontWeight: '700', marginTop: 12 },
});
