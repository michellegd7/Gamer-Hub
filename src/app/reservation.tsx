import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { fetchPlaytimePackages, fetchStations, HubPackage, HubStation, reserveStation, reserveStationWithSavedTime } from '../data/gamingHub';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import OptionRow from '../components/OptionRow';
import { supabase } from '../lib/supabase';

export default function Reservation() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [stationList, setStationList] = useState<HubStation[]>([]);
  const [stationLoading, setStationLoading] = useState(true);
  const [stationError, setStationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [startAt, setStartAt] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [pickerDraft, setPickerDraft] = useState<Date | null>(null);
  const [savedTimeSeconds, setSavedTimeSeconds] = useState(0);
  const [useSavedTime, setUseSavedTime] = useState(false);
  const [savedTimeLoading, setSavedTimeLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    fetchStations().then(data => {
      if (!mounted) return;
      setStationList(data);
    }).catch(error => {
      if (mounted) setStationError(error instanceof Error ? error.message : 'Could not load stations from Supabase.');
    }).finally(() => { if (mounted) setStationLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadSavedTime = async () => {
      setSavedTimeLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) { setSavedTimeSeconds(0); setSavedTimeLoading(false); } return; }
      const { data, error } = await supabase.from('playtime_wallets').select('balance_seconds').eq('customer_id', user.id).maybeSingle();
      if (mounted) {
        setSavedTimeSeconds(error ? 0 : Number(data?.balance_seconds ?? 0));
        setSavedTimeLoading(false);
      }
    };
    void loadSavedTime();
    return () => { mounted = false; };
  }, []);

  const savedTimeLabel = [Math.floor(savedTimeSeconds / 3600), Math.floor((savedTimeSeconds % 3600) / 60), savedTimeSeconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');

  const station = stationList.find(item => item.id === id);

  const [packageList, setPackageList] = useState<HubPackage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packageError, setPackageError] = useState('');
  const selected = packageList.find(item => item.id === selectedId) ?? packageList[0];

  const updateDatePart = (base: Date, picked: Date, mode: 'date' | 'time') => {
    const next = new Date(base);
    if (mode === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    return next;
  };

  const openPicker = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: startAt,
        mode,
        display: mode === 'date' ? 'calendar' : 'clock',
        minimumDate: mode === 'date' ? new Date() : undefined,
        is24Hour: false,
        onValueChange: (_event, picked) => {
          setStartAt(current => updateDatePart(current, picked, mode));
          setCustomStart(true);
        },
      });
      return;
    }
    setPickerDraft(new Date(startAt));
    setPickerMode(mode);
  };

  useEffect(() => {
    let mounted = true;
    fetchPlaytimePackages().then(data => {
      if (!mounted) return;
      setPackageList(data);
      setSelectedId(current => current || data[0]?.id || '');
    }).catch(error => {
      if (mounted) setPackageError(error instanceof Error ? error.message : 'Could not load playtime packages.');
    }).finally(() => { if (mounted) setPackagesLoading(false); });
    return () => { mounted = false; };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <AppHeader title="RESERVE YOUR STATION" />

        {stationLoading ? <ActivityIndicator color={COLORS.cyan} style={{ marginVertical: 28 }} /> : stationError ? <Text style={styles.error}>Stations could not be loaded: {stationError}</Text> : !station ? <Text style={styles.error}>This station is not in the connected Supabase project. Go back and select a station from the current list.</Text> : <View style={styles.station}>
          <View style={styles.pcImage}>
            <Text style={{ fontSize: 30 }}>🖥️</Text>
          </View>

          <View>
            <Text style={styles.white}>{station.name}</Text>
            <Text style={styles.muted}>{station.gpu}</Text>
          </View>

          <Text style={styles.rate}>
            ₱ {station.rate} / hr
          </Text>
        </View>}

        {savedTimeSeconds > 0 && <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: useSavedTime }}
          style={[styles.savedTimeCard, useSavedTime && styles.savedTimeCardSelected]}
          onPress={() => setUseSavedTime(value => !value)}
        >
          <View style={styles.savedTimeCopy}>
            <Text style={styles.savedTimeTitle}>USE SAVED PLAYTIME</Text>
            <Text style={styles.savedTimeDescription}>Your unused time · {savedTimeLabel}</Text>
            <Text style={styles.savedTimeHint}>Reserve this available station now. Staff starts the timer with your PIN.</Text>
          </View>
          <View style={[styles.savedTimeCheck, useSavedTime && styles.savedTimeCheckSelected]}><Text style={styles.savedTimeCheckText}>{useSavedTime ? '✓' : ''}</Text></View>
        </Pressable>}

        {!useSavedTime && <>
        <Text style={styles.label}>Select Package</Text>

        {packagesLoading ? <ActivityIndicator color={COLORS.cyan} style={{ marginVertical: 20 }} /> : packageError ? <Text style={styles.error}>Packages could not be loaded: {packageError}</Text> : !packageList.length ? <Text style={styles.error}>No active packages are available. Please ask staff for help.</Text> : packageList.map(item => (
          <OptionRow
            key={item.id}
            label={item.name}
            price={item.price}
            selected={selected?.id === item.id}
            onPress={() => setSelectedId(item.id)}
          />
        ))}

        <View style={styles.dateRow}>
          <View>
            <Text style={styles.label}>Date</Text>
            <Pressable accessibilityRole="button" onPress={() => openPicker('date')} style={styles.field}>
              <Text style={styles.white}>{startAt.toLocaleDateString()}</Text>
              <Text style={styles.fieldHint}>Tap to open calendar</Text>
            </Pressable>
          </View>

          <View>
            <Text style={styles.label}>Time</Text>
            <Pressable accessibilityRole="button" onPress={() => openPicker('time')} style={styles.field}>
              <Text style={styles.white}>{!customStart ? 'Starts now' : startAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Text>
              <Text style={styles.fieldHint}>Tap to choose a time</Text>
            </Pressable>
          </View>
        </View>
        {Platform.OS === 'ios' && pickerMode && pickerDraft && <View style={styles.iosPicker}>
          <DateTimePicker
            value={pickerDraft}
            mode={pickerMode}
            display="spinner"
            minimumDate={pickerMode === 'date' ? new Date() : undefined}
            themeVariant="dark"
            onValueChange={(_event, picked) => setPickerDraft(current => current ? updateDatePart(current, picked, pickerMode) : picked)}
          />
          <View style={styles.pickerActions}>
            <Pressable onPress={() => { setPickerMode(null); setPickerDraft(null); }}><Text style={styles.pickerCancel}>CANCEL</Text></Pressable>
            <Pressable onPress={() => { setStartAt(pickerDraft); setCustomStart(true); setPickerMode(null); setPickerDraft(null); }}><Text style={styles.pickerDone}>DONE</Text></Pressable>
          </View>
        </View>}
        </>}
        </ScrollView>
        <AppButton
          title={saving ? 'RESERVING…' : stationLoading ? 'LOADING STATION…' : !station ? 'STATION UNAVAILABLE' : useSavedTime ? (savedTimeLoading ? 'CHECKING BALANCE…' : `RESERVE WITH ${savedTimeLabel}`) : packagesLoading ? 'LOADING PACKAGES…' : selected ? `RESERVE & CONTINUE • ₱${selected.price}` : 'PACKAGES UNAVAILABLE'}
          onPress={async () => {
            if (saving || stationLoading || (useSavedTime ? savedTimeLoading : packagesLoading)) return;
            if (!station) {
              Alert.alert('Station unavailable', stationError || 'This station could not be matched with Supabase. Return to the stations list, refresh it, and choose a station again.');
              return;
            }
            if (!useSavedTime && !selected) {
              Alert.alert('Packages unavailable', 'Playtime packages could not be loaded. Check your connection or ask staff for help.');
              return;
            }
            if (useSavedTime && savedTimeSeconds <= 0) {
              Alert.alert('No saved playtime', 'Your account has no unused playtime balance.');
              setUseSavedTime(false);
              return;
            }
            if (station.status === 'MAINTENANCE') {
              Alert.alert('Station unavailable', 'This station is under maintenance. Choose another station.');
              router.replace('/stations');
              return;
            }
            try {
              setSaving(true);
              if (useSavedTime) {
                if (station.status !== 'AVAILABLE') {
                  Alert.alert('Station unavailable', 'Saved playtime reservations start now. Choose a currently available station.');
                  return;
                }
                const reservation = await reserveStationWithSavedTime(station.id);
                router.replace({ pathname: '/qr-activation', params: { reservationId: reservation.id } });
                return;
              }
              if (customStart && startAt.getTime() < Date.now() - 60_000) {
                Alert.alert('Choose a future time', 'The selected booking date and time have already passed. Choose a later time.');
                return;
              }
              const requestedStart = !customStart || startAt.getTime() <= Date.now() + 60_000
                ? new Date().toISOString()
                : startAt.toISOString();
              if (station.status !== 'AVAILABLE' && new Date(requestedStart).getTime() <= Date.now() + 5 * 60_000) {
                Alert.alert('Station currently in use', 'This PC cannot start a session right now. Choose a future time in the calendar or another PC.');
                return;
              }
              const reservation = await reserveStation(station.id, selected.id, requestedStart);
              router.push({ pathname: '/payment', params: {
                amount: reservation.total_amount,
                package: selected.name,
                reservationId: reservation.id,
                activationPin: reservation.activation_pin,
                startAt: reservation.start_at,
              } });
            } catch (error) {
              const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
                ? error.message
                : 'Could not complete the reservation. Check your internet connection and Supabase project configuration.';
              Alert.alert('Could not reserve', detail);
            } finally {
              setSaving(false);
            }
          }}
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  station: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  pcImage: {
    width: 70,
    height: 55,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  white: {
    color: COLORS.white,
    fontSize: 11,
  },
  muted: {
    color: COLORS.muted,
    fontSize: 9,
  },
  rate: {
    color: COLORS.white,
    fontSize: 10,
    marginLeft: 'auto',
  },
  label: {
    color: COLORS.muted,
    fontSize: 10,
    marginBottom: 10,
    marginTop: 10,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
  },
  field: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    minWidth: 130,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldHint: { color: '#B994D2', fontSize: 8, marginTop: 5 },
  iosPicker: { marginTop: 14, padding: 10, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  pickerActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 9 },
  pickerCancel: { color: COLORS.muted, fontSize: 10, fontWeight: '800' },
  pickerDone: { color: '#D6B4F4', fontSize: 10, fontWeight: '900' },
  button: {
    marginTop: 10,
    marginBottom: 16,
  },
  error: { color: '#FFC56E', fontSize: 10, lineHeight: 16, marginVertical: 14 },
  savedTimeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#15151D', borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginTop: 14 },
  savedTimeCardSelected: { borderColor: '#A855F7', backgroundColor: '#24152F' },
  savedTimeCopy: { flex: 1, gap: 4 },
  savedTimeTitle: { color: '#D7B0FF', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  savedTimeDescription: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  savedTimeHint: { color: COLORS.muted, fontSize: 8, lineHeight: 12 },
  savedTimeCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: COLORS.muted, alignItems: 'center', justifyContent: 'center' },
  savedTimeCheckSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  savedTimeCheckText: { color: COLORS.white, fontSize: 13, fontWeight: '900' },
});
