import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';

type Tab = 'Overview' | 'Stations' | 'Sessions' | 'Active Sessions' | 'Transfers' | 'Orders' | 'Maintenance' | 'Reports';
type Row = Record<string, any>;
const tabs: Tab[] = ['Overview', 'Stations', 'Sessions', 'Active Sessions', 'Transfers', 'Orders', 'Maintenance', 'Reports'];

export default function StaffConsole() {
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const [checking, setChecking] = useState(true);
  const [staff, setStaff] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>(() => requestedTab && tabs.includes(requestedTab as Tab) ? requestedTab as Tab : 'Overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stations, setStations] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [sessions, setSessions] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [transfers, setTransfers] = useState<Row[]>([]);
  const [maintenance, setMaintenance] = useState<Row[]>([]);
  const [issue, setIssue] = useState('');
  const [enteredPins, setEnteredPins] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.all([
      supabase.from('stations').select('*').order('name'),
      supabase.from('reservations').select('*, stations(name), profiles(email)').order('created_at', { ascending: false }).limit(60),
      supabase.from('sessions').select('*, stations(name), profiles(email)').order('started_at', { ascending: false }).limit(60),
      supabase.from('orders').select('*, profiles(email), order_items(quantity, food_items(name))').order('created_at', { ascending: false }).limit(60),
      supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('maintenance_records').select('*, stations(name)').order('created_at', { ascending: false }).limit(60),
      supabase.from('transfer_requests').select('*').order('created_at', { ascending: false }).limit(60),
    ]);
    const failed = results.find(result => result.error);
    if (failed?.error) setError(failed.error.message);
    else {
      setStations(results[0].data ?? []);
      setReservations(results[1].data ?? []);
      setSessions(results[2].data ?? []);
      setOrders(results[3].data ?? []);
      setPayments(results[4].data ?? []);
      setMaintenance(results[5].data ?? []);
      setTransfers(results[6].data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) { setStaff(false); setChecking(false); }
        return;
      }
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (!active) return;
      const allowed = data?.role === 'staff' || data?.role === 'admin';
      setIsAdmin(data?.role === 'admin');
      setStaff(allowed);
      setChecking(false);
      if (allowed) void load();
    };
    void checkRole();
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (!staff) return;
    const refreshTimer = setInterval(() => void load(), 15000);
    return () => clearInterval(refreshTimer);
  }, [staff, load]);

  const mutate = async (action: () => PromiseLike<{ error: any }>, success: string) => {
    const result = await action();
    if (result.error) { Alert.alert('Could not update', result.error.message); return false; }
    await load();
    Alert.alert('Updated', success);
    return true;
  };

  const setStationStatus = (station: Row) => {
    if (station.status !== 'AVAILABLE' && station.status !== 'MAINTENANCE') {
      Alert.alert('Station is in use', 'End its active session before changing its maintenance status.');
      return;
    }
    const next = station.status === 'MAINTENANCE' ? 'AVAILABLE' : 'MAINTENANCE';
    Alert.alert(`${next === 'AVAILABLE' ? 'Return to service' : 'Mark for maintenance'}?`, `${station.name} will be marked ${next.toLowerCase()}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void mutate(() => supabase.from('stations').update({ status: next, updated_at: new Date().toISOString() }).eq('id', station.id), `${station.name} is ${next.toLowerCase()}.`) },
    ]);
  };

  const reportMaintenance = async (station: Row) => {
    if (!issue.trim()) { Alert.alert('Add a maintenance note', 'Describe the issue before submitting.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const result = await supabase.from('maintenance_records').insert({ station_id: station.id, reported_by: user.id, issue: issue.trim() });
    if (result.error) { Alert.alert('Could not create report', result.error.message); return; }
    const statusResult = await supabase.from('stations').update({ status: 'MAINTENANCE' }).eq('id', station.id);
    if (statusResult.error) { Alert.alert('Station update failed', statusResult.error.message); return; }
    setIssue('');
    await load();
  };

  const changeOrder = (order: Row, status: string) => void mutate(
    () => supabase.rpc('update_gamerhub_order_status', { p_order_id: order.id, p_status: status }),
    `Order status changed to ${status.toLowerCase()}.`,
  );

  const markPaymentVerified = (payment: Row) => Alert.alert(
    'Record verified payment?',
    'Only confirm after the payment is received and verified at your payment provider or counter.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark as paid', onPress: async () => {
        const update = await supabase.rpc('verify_gamerhub_payment', { p_payment_id: payment.id });
        if (update.error) { Alert.alert('Could not verify payment', update.error.message); return; }
        await load();
      } },
    ],
  );

  const activate = (reservation: Row) => {
    const pin = enteredPins[reservation.id] ?? '';
    if (!/^\d{6}$/.test(pin)) {
      Alert.alert('Enter the reservation PIN', 'Ask the customer for their six-digit PIN before activating this session.');
      return;
    }
    void mutate(
      () => supabase.rpc('activate_gamerhub_reservation_with_pin', { p_reservation_id: reservation.id, p_pin: pin }),
      `Session started at ${reservation.stations?.name ?? 'the reserved station'}.`,
    ).then(success => {
      if (success) setEnteredPins(current => ({ ...current, [reservation.id]: '' }));
    });
  };
  const endSession = (session: Row) => Alert.alert('End this session?', `${session.stations?.name ?? 'Station'} will become available.`, [
    { text: 'Keep playing', style: 'cancel' },
    { text: 'End session', style: 'destructive', onPress: () => void mutate(
      () => supabase.rpc('end_gamerhub_session', { p_session_id: session.id }), 'Session stopped. Any unused time was saved to the gamer’s balance, and the station was released.',
    ) },
  ]);

  const activeSessions = sessions.filter(item => item.status === 'ACTIVE');
  const availableStations = stations.filter(item => item.status === 'AVAILABLE').length;
  const openIssues = maintenance.filter(item => item.status !== 'RESOLVED').length;
  const revenue = payments.filter(item => item.status === 'PAID').reduce((sum, item) => sum + Number(item.amount), 0);
  const hourlyUsage = Array.from({ length: 8 }, (_, index) => {
    const hour = index + 12;
    return { hour: `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`, count: sessions.filter(session => new Date(session.started_at).getHours() === hour).length };
  });
  const maxUsage = Math.max(1, ...hourlyUsage.map(item => item.count));

  if (checking) return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Checking staff access…</Text></View></SafeAreaView>;
  if (!staff) return <SafeAreaView style={styles.container}><View style={styles.denied}><View style={styles.deniedIcon}><Ionicons name="lock-closed-outline" size={25} color="#D5ABFF" /></View><Text style={styles.title}>Staff access only</Text><Text style={styles.muted}>This workspace is for authorized GamerHub staff. Ask an admin to assign your account the staff role.</Text><Pressable style={styles.primaryButton} onPress={() => router.replace('/home')}><Text style={styles.primaryText}>Back to GamerHub</Text></Pressable></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}><Pressable onPress={() => router.replace(isAdmin ? '/admin-dashboard' as any : '/home')} style={styles.headerBack} accessibilityRole="button" accessibilityLabel={isAdmin ? 'Return to Admin Dashboard' : 'Return to GamerHub'}><Ionicons name="arrow-back" size={20} color={COLORS.white} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>GAMERHUB OPERATIONS</Text><Text style={styles.header}>Staff console</Text></View><Pressable onPress={() => void load()} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Refresh staff data"><Ionicons name="refresh-outline" size={18} color={COLORS.white} /></Pressable></View>
      <ScrollView horizontal style={styles.tabScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</ScrollView>
      {loading && !stations.length ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading live hub data…</Text></View> : error ? <View style={styles.errorBox}><Ionicons name="warning-outline" size={20} color="#FFC56E" /><Text style={styles.errorText}>{error}{'\n\n'}Apply the GamerHub migration in supabase/migrations, then refresh.</Text></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'Overview' && <>
          <View style={styles.welcome}><Text style={styles.welcomeTitle}>Hub status</Text><Text style={styles.welcomeSub}>Live operations at a glance</Text><View style={styles.welcomeStats}><Text style={styles.welcomeStat}>{availableStations}<Text style={styles.welcomeUnit}> available</Text></Text><Text style={styles.welcomeStat}>{activeSessions.length}<Text style={styles.welcomeUnit}> active sessions</Text></Text></View></View>
          <View style={styles.metricGrid}><Metric label="Stations" value={String(stations.length)} icon="desktop-outline" /><Metric label="Open issues" value={String(openIssues)} icon="construct-outline" /><Metric label="Orders today" value={String(orders.length)} icon="receipt-outline" /><Metric label="Verified revenue" value={`₱${revenue.toLocaleString('en-PH')}`} icon="cash-outline" /></View>
          <SectionTitle title="Needs attention" /><RowCard title={`${reservations.filter(item => item.status === 'PENDING_PAYMENT').length} pending payments`} subtitle="Verify received payments before activation" icon="card-outline" onPress={() => setTab('Sessions')} />
          <RowCard title={`${orders.filter(item => item.status === 'PLACED' || item.status === 'PREPARING').length} orders in progress`} subtitle="Update preparation and pickup status" icon="fast-food-outline" onPress={() => setTab('Orders')} />
          <RowCard title={`${openIssues} maintenance reports`} subtitle="Review stations that need attention" icon="construct-outline" onPress={() => setTab('Maintenance')} />
          <Text style={styles.note}>Payment collection happens through your configured provider or at the counter. This console records staff verification; it does not charge a card or e-wallet.</Text>
        </>}
        {tab === 'Stations' && <><SectionTitle title="Station management" subtitle="Availability and maintenance state" />{stations.map(station => <View key={station.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.stationGlyph}><Ionicons name="desktop-outline" size={21} color={COLORS.cyan} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{station.name}</Text><Text style={styles.cardSub}>{station.station_type} · ₱{station.hourly_rate}/hour</Text></View><StatusPill status={station.status} /></View><Text style={styles.spec}>{[station.processor, station.gpu, station.ram].filter(Boolean).join(' · ')}</Text>{station.status === 'AVAILABLE' || station.status === 'MAINTENANCE' ? <Pressable onPress={() => setStationStatus(station)} style={styles.smallAction}><Text style={styles.smallActionText}>{station.status === 'MAINTENANCE' ? 'Return to available' : 'Mark for maintenance'}</Text></Pressable> : <Text style={styles.cardSub}>End the session before changing this station.</Text>}</View>)}</>}
        {tab === 'Sessions' && <><SectionTitle title="Reservations & payments" subtitle="Verify payments and activate confirmed reservations" /><Text style={styles.subsection}>PAYMENTS TO VERIFY</Text>{payments.filter(item => item.status === 'PENDING').map(payment => <View key={payment.id} style={styles.card}><Text style={styles.cardTitle}>₱{Number(payment.amount).toFixed(2)} · {payment.method}</Text><Text style={styles.cardSub}>{payment.reservation_id ? 'Reservation' : payment.session_id ? 'Playtime extension' : payment.order_id ? `Food order · ${payment.order_id.slice(0, 8)}` : 'Payment'} · Ref {payment.id.slice(0, 8)}</Text><Pressable onPress={() => markPaymentVerified(payment)} style={styles.smallAction}><Text style={styles.smallActionText}>Verify received payment</Text></Pressable></View>)}{!payments.some(item => item.status === 'PENDING') && <Empty label="No pending payments" />}<Text style={styles.subsection}>CONFIRMED RESERVATIONS</Text>{reservations.filter(item => item.status === 'CONFIRMED').map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.stations?.name ?? item.station_id} · {item.profiles?.email ?? 'Customer'}</Text><Text style={styles.cardSub}>{new Date(item.start_at).toLocaleString()} · ₱{Number(item.total_amount).toFixed(2)}</Text><TextInput value={enteredPins[item.id] ?? ''} onChangeText={value => setEnteredPins(current => ({ ...current, [item.id]: value.replace(/\D/g, '').slice(0, 6) }))} placeholder="Enter customer 6-digit PIN" placeholderTextColor={COLORS.muted} keyboardType="number-pad" maxLength={6} style={styles.issueInput} /><Pressable onPress={() => activate(item)} style={styles.smallAction}><Text style={styles.smallActionText}>Activate session</Text></Pressable></View>)}{!reservations.some(item => item.status === 'CONFIRMED') && <Empty label="No confirmed reservations waiting for activation" />}</>}
        {tab === 'Active Sessions' && <><SectionTitle title="Active sessions" subtitle="Live timers for customers currently using a station" />{activeSessions.map(item => <View key={item.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{item.stations?.name ?? item.station_id}</Text><Text style={styles.cardSub}>{item.profiles?.email ?? 'Customer'}</Text></View><StatusPill status={item.status} /></View><Text style={styles.cardSub}>Started {new Date(item.started_at).toLocaleTimeString()} · Ends {new Date(item.ends_at).toLocaleTimeString()}</Text><SessionCountdown endsAt={item.ends_at} /><Pressable onPress={() => endSession(item)} style={[styles.smallAction, styles.dangerAction]}><Text style={[styles.smallActionText, styles.dangerText]}>End session</Text></Pressable></View>)}{!activeSessions.length && <Empty label="No active sessions right now" />}</>}
        {tab === 'Transfers' && <><SectionTitle title="Computer transfer requests" subtitle="Approve a move only when the destination station is still available" />{transfers.filter(item => item.status === 'PENDING').map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.from_station_id} → {item.to_station_id}</Text><Text style={styles.cardSub}>{item.reason || 'No reason provided'} · {new Date(item.created_at).toLocaleTimeString()}</Text><View style={styles.actionRow}><Pressable onPress={() => void mutate(() => supabase.rpc('resolve_gamerhub_transfer_request', { p_request_id: item.id, p_approve: true }), 'Station transfer approved.')} style={styles.smallAction}><Text style={styles.smallActionText}>Approve transfer</Text></Pressable><Pressable onPress={() => void mutate(() => supabase.rpc('resolve_gamerhub_transfer_request', { p_request_id: item.id, p_approve: false }), 'Station transfer declined.')} style={[styles.smallAction, styles.dangerAction]}><Text style={[styles.smallActionText, styles.dangerText]}>Decline</Text></Pressable></View></View>)}{!transfers.some(item => item.status === 'PENDING') && <Empty label="No pending transfer requests" />}</>}
        {tab === 'Orders' && <><SectionTitle title="Orders & payments" subtitle="Track fulfillment and verify payment records" />{orders.map(order => { const orderPayment = payments.find(item => item.order_id === order.id); return <View key={order.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>Order {order.id.slice(0, 8)}</Text><Text style={styles.cardSub}>{order.profiles?.email ?? 'Customer'} · {new Date(order.created_at).toLocaleTimeString()}</Text></View><Text style={styles.money}>₱{Number(order.total_amount).toFixed(2)}</Text></View><Text style={styles.cardSub}>Payment: {orderPayment ? `${orderPayment.method} · ${orderPayment.status}` : 'Not recorded'}</Text>{order.order_items?.map((item: Row, index: number) => <Text key={`${order.id}-${index}`} style={styles.cardSub}>{item.food_items?.name ?? 'Menu item'} × {item.quantity}</Text>)}<View style={styles.actionRow}>{(order.status === 'PLACED' ? ['PREPARING', 'CANCELLED'] : order.status === 'PREPARING' ? ['READY', 'CANCELLED'] : order.status === 'READY' ? ['COMPLETED'] : []).map(next => <Pressable key={next} onPress={() => changeOrder(order, next)} style={styles.smallAction}><Text style={styles.smallActionText}>{next === 'COMPLETED' ? 'Mark picked up' : next === 'CANCELLED' ? 'Cancel' : `Mark ${next.toLowerCase()}`}</Text></Pressable>)}<StatusPill status={order.status} /></View></View>; })}{!orders.length && <Empty label="No orders yet" />}</>}
        {tab === 'Maintenance' && <><SectionTitle title="Maintenance" subtitle="Log an issue and take the station out of service" /><TextInput value={issue} onChangeText={setIssue} placeholder="Describe the problem" placeholderTextColor={COLORS.muted} style={styles.issueInput} /><Text style={styles.subsection}>CHOOSE STATION</Text>{stations.map(station => <Pressable key={station.id} onPress={() => void reportMaintenance(station)} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{station.name}</Text><Text style={styles.cardSub}>{station.status}</Text></View><Ionicons name="add-circle-outline" size={20} color="#C58AFF" /></View></Pressable>)}<Text style={styles.subsection}>OPEN MAINTENANCE</Text>{maintenance.filter(item => item.status !== 'RESOLVED').map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.stations?.name ?? item.station_id}</Text><Text style={styles.cardSub}>{item.issue}</Text><Text style={styles.cardSub}>{item.status} · {new Date(item.created_at).toLocaleDateString()}</Text><Pressable onPress={() => void mutate(async () => { const result = await supabase.from('maintenance_records').update({ status: 'RESOLVED', resolved_at: new Date().toISOString() }).eq('id', item.id); if (!result.error) await supabase.from('stations').update({ status: 'AVAILABLE' }).eq('id', item.station_id); return result; }, 'Issue marked resolved.')} style={styles.smallAction}><Text style={styles.smallActionText}>Mark resolved</Text></Pressable></View>)}</>}
        {tab === 'Reports' && <><SectionTitle title="Usage & revenue" subtitle="Based on recorded Supabase sessions and verified payments" /><View style={styles.reportCard}><Text style={styles.cardTitle}>Verified revenue</Text><Text style={styles.reportValue}>₱{revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</Text><Text style={styles.cardSub}>{payments.filter(item => item.status === 'PAID').length} verified payment records</Text></View><View style={styles.reportCard}><Text style={styles.cardTitle}>Station utilization</Text><View style={styles.utilization}><Text style={styles.utilValue}>{stations.length ? Math.round((activeSessions.length / stations.length) * 100) : 0}%</Text><Text style={styles.cardSub}>{activeSessions.length} active of {stations.length} stations</Text></View></View><View style={styles.reportCard}><Text style={styles.cardTitle}>Peak session start hours</Text><View style={styles.chart}>{hourlyUsage.map(item => <View key={item.hour} style={styles.chartCol}><Text style={styles.chartValue}>{item.count || ''}</Text><View style={[styles.bar, { height: Math.max(4, item.count / maxUsage * 74) }]} /><Text style={styles.chartLabel}>{item.hour}</Text></View>)}</View></View><View style={styles.metricGrid}><Metric label="Sessions logged" value={String(sessions.length)} icon="timer-outline" /><Metric label="Completed orders" value={String(orders.filter(item => item.status === 'COMPLETED').length)} icon="checkmark-done-outline" /></View></>}
      </ScrollView>}
    </SafeAreaView>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) {
  return <View style={styles.metric}><Ionicons name={icon} size={17} color="#C58AFF" /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text>{subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}</View>; }
function StatusPill({ status }: { status: string }) { const color = status === 'AVAILABLE' || status === 'PAID' || status === 'COMPLETED' || status === 'READY' ? '#59E6AA' : status === 'MAINTENANCE' || status === 'PENDING' || status === 'PENDING_PAYMENT' ? '#FFC56E' : '#C58AFF'; return <View style={[styles.pill, { backgroundColor: `${color}20` }]}><Text style={[styles.pillText, { color }]}>{status.replace('_', ' ')}</Text></View>; }
function RowCard({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) { return <Pressable style={styles.card} onPress={onPress}><View style={styles.cardHeader}><Ionicons name={icon} size={21} color="#C58AFF" /><View style={styles.rowCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSub}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={16} color={COLORS.muted} /></View></Pressable>; }
function Empty({ label }: { label: string }) { return <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={22} color="#59E6AA" /><Text style={styles.muted}>{label}</Text></View>; }
function SessionCountdown({ endsAt }: { endsAt: string }) { const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000))); useEffect(() => { const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000))), 1000); return () => clearInterval(timer); }, [endsAt]); return <Text style={styles.countdown}>Remaining {String(Math.floor(seconds / 3600)).padStart(2, '0')}:{String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, topBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, headerBack: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface }, headerCopy: { flex: 1 }, kicker: { color: '#C58AFF', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 }, header: { color: COLORS.white, fontSize: 22, fontWeight: '800', marginTop: 4 }, refresh: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface }, tabScroller: { height: 49, flexGrow: 0, flexShrink: 0, marginBottom: 5 }, tabs: { height: 42, alignItems: 'center', paddingHorizontal: 18, gap: 7 }, tab: { height: 36, minWidth: 67, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border }, tabActive: { backgroundColor: '#42205D', borderColor: '#7541A0' }, tabText: { color: COLORS.muted, fontWeight: '700', fontSize: 9 }, tabTextActive: { color: '#E1C5FF' }, content: { paddingHorizontal: 18, paddingBottom: 24 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }, muted: { color: COLORS.muted, fontSize: 11, textAlign: 'center', lineHeight: 17 }, errorBox: { margin: 18, padding: 16, gap: 10, backgroundColor: '#31271A', borderRadius: 14 }, errorText: { color: '#F4D9A6', fontSize: 11, lineHeight: 18 }, welcome: { backgroundColor: '#29133B', borderColor: '#4B2863', borderWidth: 1, borderRadius: 19, padding: 17 }, welcomeTitle: { color: COLORS.white, fontWeight: '800', fontSize: 17 }, welcomeSub: { color: '#CAB4D8', fontSize: 10, marginTop: 4 }, welcomeStats: { flexDirection: 'row', gap: 20, marginTop: 18 }, welcomeStat: { color: '#D7B0FF', fontSize: 20, fontWeight: '800' }, welcomeUnit: { color: '#CAB4D8', fontSize: 9, fontWeight: '500' }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 }, metric: { width: '48%', minHeight: 95, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 12, justifyContent: 'space-between' }, metricValue: { color: COLORS.white, fontWeight: '800', fontSize: 17, marginTop: 6 }, metricLabel: { color: COLORS.muted, fontSize: 9 }, sectionTitle: { marginTop: 9, marginBottom: 13 }, sectionHeading: { color: COLORS.white, fontSize: 16, fontWeight: '800' }, sectionSub: { color: COLORS.muted, fontSize: 10, marginTop: 4, lineHeight: 15 }, card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#292934', borderRadius: 15, padding: 12, marginBottom: 9 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stationGlyph: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#122534', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, rowCopy: { flex: 1, marginHorizontal: 10 }, cardTitle: { color: COLORS.white, fontSize: 11, fontWeight: '800' }, cardSub: { color: COLORS.muted, fontSize: 9, marginTop: 4 }, spec: { color: COLORS.muted, fontSize: 9, marginTop: 10 }, pill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9 }, pillText: { fontSize: 7, fontWeight: '800' }, smallAction: { alignSelf: 'flex-start', marginTop: 11, borderWidth: 1, borderColor: '#70459A', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 }, smallActionText: { color: '#D6B4F4', fontSize: 9, fontWeight: '800' }, subsection: { color: '#BB9BD4', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 14, marginBottom: 8 }, pin: { color: '#66E1C3', fontSize: 16, fontWeight: '900', letterSpacing: 2, marginTop: 10 }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 4 }, dangerAction: { borderColor: '#8F3548' }, dangerText: { color: '#FF9AAE' }, money: { color: '#D7B0FF', fontWeight: '800', fontSize: 11 }, issueInput: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, color: COLORS.white, fontSize: 11 }, empty: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, note: { color: COLORS.muted, fontSize: 9, lineHeight: 15, marginTop: 13, marginBottom: 10 }, reportCard: { backgroundColor: COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, padding: 15, marginBottom: 10 }, reportValue: { color: '#D7B0FF', fontSize: 27, fontWeight: '900', marginTop: 9 }, utilization: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }, utilValue: { color: '#69DDBE', fontSize: 29, fontWeight: '900' }, chart: { height: 125, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginTop: 15 }, chartCol: { alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }, chartValue: { height: 12, color: '#D7B0FF', fontSize: 8 }, bar: { width: 15, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: '#9D53DB' }, chartLabel: { color: COLORS.muted, fontSize: 8 }, countdown: { color: '#67E2BE', fontSize: 12, fontWeight: '800', marginTop: 8 }, denied: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, deniedIcon: { width: 62, height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#322140', marginBottom: 18 }, title: { color: COLORS.white, fontSize: 20, fontWeight: '800', marginBottom: 8 }, primaryButton: { backgroundColor: COLORS.primary, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 12, marginTop: 20 }, primaryText: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
});
