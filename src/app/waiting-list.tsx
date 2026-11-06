import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { joinWaitlist } from '../data/gamingHub';
import { supabase } from '../lib/supabase';

type Entry = { id: string; station_type: string; status: string; created_at: string };

export default function WaitingList() {
  const [type, setType] = useState('PC');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage('Sign in to join the waitlist.'); setLoading(false); return; }
    const { data, error } = await supabase.from('waitlist_entries').select('*').eq('customer_id', user.id).eq('status', 'WAITING').maybeSingle();
    if (error) { setMessage(error.message); setLoading(false); return; }
    setEntry(data);
    if (data) {
      const { data: position } = await supabase.rpc('get_gamerhub_waitlist_position', { p_entry_id: data.id });
      setQueueNumber(position ?? 1);
    } else setQueueNumber(null);
    setLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    const loadEntry = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) { setMessage('Sign in to join the waitlist.'); setLoading(false); return; }
      const { data, error } = await supabase.from('waitlist_entries').select('*').eq('customer_id', user.id).eq('status', 'WAITING').maybeSingle();
      if (!mounted) return;
      if (error) { setMessage(error.message); setLoading(false); return; }
      setEntry(data);
      if (data) {
        const { data: position } = await supabase.rpc('get_gamerhub_waitlist_position', { p_entry_id: data.id });
        if (!mounted) return;
        setQueueNumber(position ?? 1);
      } else setQueueNumber(null);
      setLoading(false);
    };
    void loadEntry();
    return () => { mounted = false; };
  }, []);

  const handleJoin = async () => {
    if (saving || entry) return;
    setSaving(true);
    try {
      await joinWaitlist(type);
      await refresh();
    } catch (error) {
      Alert.alert('Could not join the queue', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!entry) return;
    setSaving(true);
    const { error } = await supabase.from('waitlist_entries').update({ status: 'CANCELLED' }).eq('id', entry.id);
    if (error) Alert.alert('Could not cancel', error.message);
    else { setEntry(null); setQueueNumber(null); }
    setSaving(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="WAITLIST" />
        <View style={styles.heroIcon}><Ionicons name="hourglass-outline" size={28} color="#FFC56E" /></View>
        <Text style={styles.title}>{entry ? 'You’re in the queue' : 'Join the waiting list'}</Text>
        <Text style={styles.description}>{entry ? `We’ll keep your place for a ${entry.station_type} station.` : 'If your preferred station type is full, save your place in line and check back here for updates.'}</Text>
        {!entry && <>
          <Text style={styles.heading}>PREFERRED STATION TYPE</Text>
          <View style={styles.types}>{[['PC', 'desktop-outline'], ['VIP', 'game-controller-outline'], ['PlayStation', 'game-controller-outline']].map(([name, icon]) => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: type === name }} style={[styles.type, type === name && styles.selected]} onPress={() => setType(name)}><Ionicons name={icon as any} color={type === name ? COLORS.cyan : COLORS.muted} size={23} /><Text style={[styles.typeText, type === name && styles.typeTextSelected]}>{name}</Text></Pressable>)}</View>
        </>}
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 28 }} /> : message ? <Text style={styles.message}>{message}</Text> : entry ? <View style={styles.queue}><Text style={styles.queueLabel}>YOUR QUEUE POSITION</Text><Text style={styles.number}>#{queueNumber ?? '—'}</Text><View style={styles.queueDivider} /><Text style={styles.queueInfo}>Joined {new Date(entry.created_at).toLocaleString()}</Text><Text style={styles.queueInfo}>Status · {entry.status}</Text><Text style={styles.queueInfo}>This screen shows your current place. Push notifications are not configured yet.</Text></View> : <Text style={styles.message}>Join now to save your place in line.</Text>}
        {!entry ? <AppButton title={saving ? 'JOINING…' : 'JOIN WAITLIST'} onPress={() => void handleJoin()} style={{ marginTop: 'auto', marginBottom: 10 }} /> : <AppButton title={saving ? 'UPDATING…' : 'CANCEL MY PLACE'} variant="outline" onPress={() => void cancel()} style={{ marginTop: 'auto', marginBottom: 10 }} />}
        <Pressable onPress={() => router.replace('/stations')} style={styles.browse}><Text style={styles.browseText}>Browse stations instead</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20, paddingBottom: 14 }, heroIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: '#352B20', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 27 }, title: { color: COLORS.white, textAlign: 'center', fontSize: 20, fontWeight: '800', marginTop: 17 }, description: { color: COLORS.muted, textAlign: 'center', fontSize: 11, lineHeight: 18, marginTop: 9, maxWidth: 310, alignSelf: 'center' }, heading: { color: COLORS.white, marginTop: 30, marginBottom: 12, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, types: { flexDirection: 'row', gap: 10 }, type: { flex: 1, height: 54, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' }, selected: { borderColor: COLORS.primary, backgroundColor: COLORS.purpleSoft }, typeText: { color: COLORS.muted, fontWeight: '700', fontSize: 10 }, typeTextSelected: { color: COLORS.white }, queue: { borderWidth: 1, borderColor: '#514063', borderRadius: 17, backgroundColor: COLORS.surface, padding: 20, marginTop: 25, alignItems: 'center' }, queueLabel: { color: '#D7B0FF', fontSize: 9, letterSpacing: 1, fontWeight: '800' }, number: { color: COLORS.cyan, fontSize: 43, fontWeight: '900', marginVertical: 6 }, queueDivider: { alignSelf: 'stretch', height: 1, backgroundColor: COLORS.border, marginVertical: 10 }, queueInfo: { color: COLORS.muted, fontSize: 9, textAlign: 'center', marginTop: 7, lineHeight: 14 }, message: { color: COLORS.muted, textAlign: 'center', fontSize: 10, marginTop: 25 }, browse: { alignItems: 'center', padding: 10 }, browseText: { color: '#C58AFF', fontSize: 10, fontWeight: '700' } });
