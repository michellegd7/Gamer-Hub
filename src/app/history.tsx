import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import AllSessionPinsModal from '../components/AllSessionPinsModal';
import { supabase } from '../lib/supabase';

type HistoryRow = Record<string, any>;
const views = ['Sessions', 'Orders', 'Payments'];

export default function History() {
  const [tab, setTab] = useState('Sessions');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSessionPins, setShowSessionPins] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      setLoading(true);
      setError('');
      const { data: { user } } = await supabase.auth.getUser();
      const result = tab === 'Sessions'
        ? user
          ? await supabase.from('reservations').select('id,activation_pin,status,start_at,ends_at,total_amount,station_id,stations(name)').eq('customer_id', user.id).order('created_at', { ascending: false }).limit(1000)
          : { data: [], error: null }
        : tab === 'Orders'
          ? await supabase.from('orders').select('*, order_items(quantity, food_items(name))').order('created_at', { ascending: false }).limit(50)
          : await supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(50);
      if (!mounted) return;
      if (result.error) setError(result.error.message);
      else setRows((result.data ?? []) as HistoryRow[]);
      setLoading(false);
    };
    void refresh();
    return () => { mounted = false; };
  }, [tab]);

  const renderRow = (row: HistoryRow) => {
    if (tab === 'Sessions') {
      const pinAvailable = row.status === 'CONFIRMED' || row.status === 'ACTIVE';
      return <Pressable style={styles.card} key={row.id} onPress={() => router.push({ pathname: '/qr-activation', params: { reservationId: row.id } })}>
        <View style={styles.row}><Text style={styles.primary}>{row.stations?.name ?? row.station_id}</Text><Text style={styles.state}>{row.status}</Text></View>
        <Text style={styles.muted}>{new Date(row.start_at).toLocaleString()} · ₱{Number(row.total_amount).toFixed(2)}</Text>
        {pinAvailable ? <View style={styles.pinCard}><Text style={styles.pinLabel}>SESSION PIN</Text><Text selectable style={styles.pin}>{row.activation_pin}</Text><Text style={styles.muted}>Tap to reopen your activation screen</Text></View> : <Text style={styles.muted}>PIN is hidden for this {row.status.toLowerCase()} reservation.</Text>}
      </Pressable>;
    }
    if (tab === 'Orders') return <Pressable style={styles.card} key={row.id} onPress={() => router.push({ pathname: '/order-tracking', params: { orderId: row.id } })}><View style={styles.row}><Text style={styles.primary}>Order {row.id.slice(0, 8).toUpperCase()}</Text><Text style={styles.amount}>₱{Number(row.total_amount).toFixed(2)}</Text></View><Text style={styles.state}>{row.status}</Text><Text style={styles.muted}>{new Date(row.created_at).toLocaleString()}</Text>{row.order_items?.map((item: HistoryRow, index: number) => <Text style={styles.item} key={`${row.id}-${index}`}>{item.food_items?.name ?? 'Menu item'} × {item.quantity}</Text>)}<Text style={styles.openLink}>Tap to track order</Text></Pressable>;
    const purpose = row.order_id ? `Food order · ${row.order_id.slice(0, 8).toUpperCase()}` : row.reservation_id ? 'Station reservation' : row.session_id ? 'Playtime extension' : 'Payment';
    return <Pressable style={styles.card} key={row.id} onPress={() => router.push({ pathname: '/receipt', params: { paymentId: row.id } })}><View style={styles.row}><Text style={styles.primary}>{row.method} · {purpose}</Text><Text style={styles.amount}>₱{Number(row.amount).toFixed(2)}</Text></View><Text style={styles.state}>{row.status}</Text><Text style={styles.muted}>{new Date(row.created_at).toLocaleString()}</Text><Text style={styles.openLink}>Tap to view receipt</Text></Pressable>;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="YOUR ACTIVITY" />
        <View style={styles.tabs}>{views.map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.active]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
        {tab === 'Sessions' && !loading && !error && <Pressable style={styles.allPinsButton} onPress={() => setShowSessionPins(true)}><Text style={styles.allPinsText}>VIEW ALL SESSION PINS</Text><Text style={styles.allPinsCount}>{rows.length}</Text></Pressable>}
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 28 }} /> : error ? <Text style={styles.empty}>{error}</Text> : <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>{rows.length ? rows.map(renderRow) : <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing here yet</Text><Text style={styles.muted}>Your {tab.toLowerCase()} will appear after you use GamerHub.</Text>{tab === 'Sessions' && <Pressable style={styles.emptyAction} onPress={() => router.push('/stations')}><Text style={styles.emptyActionText}>FIND A STATION</Text></Pressable>}</View>}</ScrollView>}
      </View>
      <BottomNav active="PROFILE" />
      <AllSessionPinsModal visible={showSessionPins} onClose={() => setShowSessionPins(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20 }, tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 }, tab: { backgroundColor: COLORS.surface, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border }, active: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, tabText: { color: COLORS.muted, fontWeight: '700', fontSize: 9 }, tabTextActive: { color: COLORS.white }, list: { paddingBottom: 22 }, card: { backgroundColor: COLORS.surface, borderRadius: 13, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border }, pinCard: { backgroundColor: '#12111A', borderRadius: 10, padding: 12, marginTop: 10, alignItems: 'center' }, pinLabel: { color: '#C9A4E6', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 }, pin: { color: '#74E4D1', fontSize: 24, fontWeight: '900', letterSpacing: 6, marginTop: 5 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, primary: { color: '#D7B0FF', fontWeight: '800', fontSize: 11, flexShrink: 1 }, amount: { color: COLORS.white, fontSize: 10, fontWeight: '700' }, state: { color: '#65DDBA', fontSize: 9, fontWeight: '700', marginTop: 7 }, muted: { color: COLORS.muted, fontSize: 9, marginTop: 5 }, item: { color: COLORS.white, fontSize: 9, marginTop: 5 }, openLink: { color: '#C58AFF', fontSize: 9, fontWeight: '700', marginTop: 8 }, empty: { alignItems: 'center', paddingHorizontal: 25, paddingVertical: 35, color: COLORS.muted, textAlign: 'center' }, emptyTitle: { color: COLORS.white, fontSize: 13, fontWeight: '800', marginBottom: 7 }, emptyAction: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10, marginTop: 15 }, emptyActionText: { color: COLORS.white, fontSize: 9, fontWeight: '800' }, allPinsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#21152D', borderColor: '#59366F', borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 12 }, allPinsText: { color: '#D7B0FF', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 }, allPinsCount: { color: COLORS.white, fontSize: 9, fontWeight: '800' } });
