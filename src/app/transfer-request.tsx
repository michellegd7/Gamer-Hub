import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import StationCard from '../components/StationCard';
import { fetchStations } from '../data/gamingHub';
import { supabase } from '../lib/supabase';

export default function TransferRequest() {
  const { sessionId, stationId } = useLocalSearchParams<{ sessionId: string; stationId: string }>();
  const [stations, setStations] = useState<Awaited<ReturnType<typeof fetchStations>>>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationsError, setStationsError] = useState('');
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { let mounted = true; fetchStations().then(data => { if (mounted) { setStations(data); setStationsError(''); } }).catch(error => { if (mounted) setStationsError(error instanceof Error ? error.message : 'Could not load live station availability.'); }).finally(() => { if (mounted) setStationsLoading(false); }); return () => { mounted = false; }; }, []);
  const available = stations.filter(station => station.status === 'AVAILABLE' && station.id !== stationId);

  const submit = async () => {
    if (!sessionId || !selected || saving) { Alert.alert('Choose a station', 'Select an available station for your transfer request.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('create_gamerhub_transfer_request', { p_session_id: sessionId, p_target_station: selected, p_reason: reason.trim() });
      if (error) throw error;
      Alert.alert('Request sent', 'Staff will review your transfer. Your current station remains active until the request is approved.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) { Alert.alert('Could not send request', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <AppHeader title="TRANSFER REQUEST" />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.current}><Text style={styles.muted}>CURRENT STATION</Text><Text style={styles.pc}>{stationId || 'Active session'}</Text></View>
          <Text style={styles.heading}>Available stations</Text>
          {stationsLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 18 }} /> : stationsError ? <Text style={styles.error}>{stationsError}{'\n'}Refresh the live station list before requesting a transfer.</Text> : available.map(station => <View key={station.id} style={selected === station.id ? styles.selected : undefined}><StationCard station={station} onPress={() => setSelected(station.id)} /></View>)}
          {!stationsLoading && !stationsError && !available.length && <Text style={styles.muted}>No other stations are available right now.</Text>}
          <Text style={styles.heading}>Reason (optional)</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Add a note for staff" placeholderTextColor={COLORS.muted} style={styles.input} maxLength={180} returnKeyType="done" />
          <Text style={styles.note}>Your current session stays active until staff approves the move. If approved, your remaining time continues on the new station.</Text>
        </ScrollView>
        <View style={styles.footer}>
          <AppButton title={saving ? 'SENDING REQUEST…' : 'SEND TRANSFER REQUEST'} onPress={() => { if (!saving && !stationsLoading && !stationsError && available.length) void submit(); }} style={{ opacity: saving || stationsLoading || Boolean(stationsError) || !available.length ? 0.5 : 1 }} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardArea: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  current: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.cyan, borderRadius: 13, padding: 13, marginVertical: 15 },
  muted: { color: COLORS.muted, fontSize: 9 },
  error: { color: '#FFC56E', fontSize: 9, lineHeight: 15, marginVertical: 9 },
  pc: { color: COLORS.cyan, fontSize: 17, fontWeight: '800', marginTop: 5 },
  heading: { color: COLORS.white, fontSize: 10, fontWeight: '800', marginVertical: 9 },
  selected: { borderWidth: 1, borderColor: COLORS.primary, borderRadius: 14, padding: 2 },
  input: { minHeight: 45, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, color: COLORS.white, fontSize: 10 },
  note: { color: COLORS.muted, fontSize: 9, marginTop: 10, lineHeight: 14 },
});
