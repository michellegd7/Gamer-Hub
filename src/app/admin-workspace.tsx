import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { signOutWithPushCleanup } from '../lib/pushNotifications';

type Tab = 'Overview' | 'Stations' | 'Sessions' | 'Active Sessions' | 'Transfers' | 'Orders' | 'Maintenance' | 'Transactions' | 'Customers' | 'Reports';
type Row = Record<string, any>;
type AdminReport = { verified_revenue: number; paid_transactions: number; sessions_total: number; completed_orders: number; orders_today: number; peak_hours: { hour: number; count: number }[] };
const tabs: Tab[] = ['Overview', 'Stations', 'Sessions', 'Active Sessions', 'Transfers', 'Orders', 'Maintenance', 'Transactions', 'Customers', 'Reports'];

export default function StaffConsole() {
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const [checking, setChecking] = useState(true);
  const [staff, setStaff] = useState(false);
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
  const [customers, setCustomers] = useState<Row[]>([]);
  const [report, setReport] = useState<AdminReport | null>(null);
  const [reportError, setReportError] = useState('');
  const [issue, setIssue] = useState('');
  const [enteredPins, setEnteredPins] = useState<Record<string, string>>({});
  const [newReservationCount, setNewReservationCount] = useState(0);
  const [latestReservationNotice, setLatestReservationNotice] = useState<Row | null>(null);

  const logout = async () => {
    try {
      await signOutWithPushCleanup();
      router.replace('/');
    } catch (error) {
      Alert.alert('Could not log out', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.all([
      supabase.rpc('get_gamerhub_station_availability').order('name'),
      supabase.from('reservations').select('*, stations(name), profiles(email)').order('created_at', { ascending: false }).limit(60),
      supabase.from('sessions').select('*, stations(name), profiles(email)').order('started_at', { ascending: false }).limit(60),
      supabase.from('orders').select('*, profiles(email), order_items(quantity, food_items(name))').order('created_at', { ascending: false }).limit(60),
      supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('maintenance_records').select('*, stations(name)').order('created_at', { ascending: false }).limit(60),
      supabase.from('transfer_requests').select('*, profiles(email)').order('created_at', { ascending: false }).limit(60),
      supabase.from('profiles').select('id,email,first_name,last_name,username,role,created_at').order('created_at', { ascending: false }).limit(60),
      supabase.rpc('get_gamerhub_admin_report'),
    ]);
    const failed = results.slice(0, 8).find(result => result.error);
    if (failed?.error) setError(failed.error.message);
    else {
      setStations(results[0].data ?? []);
      setReservations(results[1].data ?? []);
      setSessions(results[2].data ?? []);
      setOrders(results[3].data ?? []);
      setPayments(results[4].data ?? []);
      setMaintenance(results[5].data ?? []);
      setTransfers(results[6].data ?? []);
      setCustomers(results[7].data ?? []);
      if (results[8].error) {
        setReportError(results[8].error.message);
        setReport(null);
      } else {
        setReport(results[8].data as AdminReport);
        setReportError('');
      }
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
      const allowed = data?.role === 'admin';
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

  useEffect(() => {
    if (!staff) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void load(), 250);
    };
    const channel = supabase.channel(`admin-session-sync-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, payload => {
        if (payload.eventType === 'INSERT') {
          setLatestReservationNotice(payload.new as Row);
          setNewReservationCount(count => count + 1);
        }
        refreshSoon();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfer_requests' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stations' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_records' }, refreshSoon)
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [staff, load]);

  const mutate = async (action: () => PromiseLike<{ error: any }>, success: string) => {
    const result = await action();
    if (result.error) { Alert.alert('Could not update', result.error.message); return false; }
    await load();
    Alert.alert('Updated', success);
    return true;
  };

  const setStationStatus = (station: Row) => {
    if (station.status === 'OCCUPIED') {
      Alert.alert('Station is in use', 'End its active session before changing its availability.');
      return;
    }

    const activeSession = sessions.some(item => item.station_id === station.id && item.status === 'ACTIVE');
    const confirmedReservation = reservations.some(item => item.station_id === station.id && item.status === 'CONFIRMED');
    const openMaintenance = maintenance.some(item => item.station_id === station.id && item.status !== 'RESOLVED');
    const choose = (next: 'AVAILABLE' | 'RESERVED' | 'MAINTENANCE') => {
      if (next === station.status) return;
      if (next === 'MAINTENANCE') {
        if (activeSession || confirmedReservation) {
          Alert.alert('Station has a customer booking', 'Complete or cancel the active session or confirmed reservation before taking this station out of service.');
          return;
        }
        setTab('Maintenance');
        Alert.alert('Add a maintenance report', `Describe the issue, then select ${station.name} to record the repair and mark it under maintenance.`);
        return;
      }
      if (next === 'AVAILABLE' && (activeSession || confirmedReservation)) {
        Alert.alert('Station has a customer booking', 'Do not mark this station available while a session is active or a confirmed reservation is waiting.');
        return;
      }
      if (next === 'AVAILABLE' && openMaintenance) {
        setTab('Maintenance');
        Alert.alert('Resolve maintenance first', 'Mark the open maintenance report as resolved before returning this station to Available.');
        return;
      }
      if (next === 'RESERVED' && (activeSession || openMaintenance)) {
        Alert.alert('Status cannot be changed', activeSession ? 'End the active session before reserving the station.' : 'Resolve the maintenance report before reserving the station.');
        return;
      }
      void mutate(
        () => supabase.rpc('set_gamerhub_station_status', { p_station_id: station.id, p_status: next }),
        `${station.name} is now ${next.toLowerCase()}. The customer station list will sync automatically.`,
      );
    };

    Alert.alert(`Set ${station.name} status`, 'Choose the status customers will see in the station list.', [
      { text: 'Available', onPress: () => choose('AVAILABLE') },
      { text: 'Reserved', onPress: () => choose('RESERVED') },
      { text: 'Maintenance', onPress: () => choose('MAINTENANCE') },
    ], { cancelable: true });
  };

  const reportMaintenance = async (station: Row) => {
    if (station.status === 'OCCUPIED' || station.status === 'RESERVED') {
      Alert.alert(station.status === 'RESERVED' ? 'Station has a reservation' : 'Station is in use', station.status === 'RESERVED' ? 'Review or complete the confirmed customer reservation before taking this station out of service.' : 'End the active session before taking this station out of service.');
      return;
    }
    if (!issue.trim()) { Alert.alert('Add a maintenance note', 'Describe the issue before submitting.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const result = await supabase.rpc('manage_gamerhub_maintenance', {
      p_station_id: station.id,
      p_action: 'REPORT',
      p_issue: issue.trim(),
      p_record_id: null,
    });
    if (result.error) { Alert.alert('Could not create report', result.error.message); return; }
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
        if (payment.method === 'PayPal') {
          Alert.alert('PayPal verifies automatically', 'Only PayPal’s server confirmation can mark this payment paid. Ask the customer to retry payment verification; do not mark it manually.');
          return;
        }
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
  const awaitingActivation = reservations.filter(item => item.status === 'CONFIRMED');
  const pendingTransfers = transfers.filter(item => item.status === 'PENDING');
  const transferHistory = transfers.filter(item => item.status !== 'PENDING');
  const stationName = (id: string) => stations.find(station => station.id === id)?.name ?? id;
  const availableStations = stations.filter(item => item.status === 'AVAILABLE').length;
  const openIssues = maintenance.filter(item => item.status !== 'RESOLVED').length;
  const revenue = Number(report?.verified_revenue ?? payments.filter(item => item.status === 'PAID').reduce((sum, item) => sum + Number(item.amount), 0));
  const hourlyUsage = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`,
    count: report?.peak_hours?.find(item => item.hour === hour)?.count ?? sessions.filter(session => new Date(session.started_at).getHours() === hour).length,
  }));
  const maxUsage = Math.max(1, ...hourlyUsage.map(item => item.count));
  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
    if (nextTab === 'Sessions') {
      setNewReservationCount(0);
      setLatestReservationNotice(null);
    }
  };

  if (checking) return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Checking staff access…</Text></View></SafeAreaView>;
  if (!staff) return <SafeAreaView style={styles.container}><View style={styles.denied}><View style={styles.deniedIcon}><Ionicons name="lock-closed-outline" size={25} color="#D5ABFF" /></View><Text style={styles.title}>Administrator access only</Text><Text style={styles.muted}>Sign in with an account assigned the admin role to manage GamerHub.</Text><Pressable style={styles.primaryButton} onPress={() => router.replace('/')}><Text style={styles.primaryText}>Return to login</Text></Pressable></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}><Pressable onPress={() => router.replace('/admin-dashboard' as any)} style={styles.headerBack} accessibilityRole="button" accessibilityLabel="Return to Admin Dashboard"><Ionicons name="arrow-back" size={20} color={COLORS.white} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>GAMERHUB ADMINISTRATION</Text><Text style={styles.header}>Admin workspace</Text></View><Pressable onPress={() => selectTab('Sessions')} style={styles.refresh} accessibilityRole="button" accessibilityLabel={`${newReservationCount ? `${newReservationCount} new reservations. ` : ''}Open reservations`}><Ionicons name="notifications-outline" size={18} color={newReservationCount ? '#C58AFF' : COLORS.white} />{newReservationCount > 0 && <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{newReservationCount > 9 ? '9+' : newReservationCount}</Text></View>}</Pressable><Pressable onPress={() => void load()} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Refresh admin data"><Ionicons name="refresh-outline" size={18} color={COLORS.white} /></Pressable><Pressable onPress={() => void logout()} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Log out of admin account"><Ionicons name="log-out-outline" size={19} color="#FF9AAE" /></Pressable></View>
      <ScrollView horizontal style={styles.tabScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => selectTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</ScrollView>
      {latestReservationNotice && <Pressable onPress={() => selectTab('Sessions')} style={styles.reservationNotice} accessibilityRole="button" accessibilityLabel="New reservation received. Open reservations and payments"><View style={styles.noticeIcon}><Ionicons name="desktop-outline" size={18} color="#D6B4F4" /></View><View style={styles.noticeCopy}><Text style={styles.noticeTitle}>New station reservation</Text><Text style={styles.noticeSub}>{latestReservationNotice.station_id ?? 'A station'} · Review payment and booking details</Text></View><Ionicons name="chevron-forward" size={18} color="#D6B4F4" /></Pressable>}
      {loading && !stations.length ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading live hub data…</Text></View> : error ? <View style={styles.errorBox}><Ionicons name="warning-outline" size={20} color="#FFC56E" /><Text style={styles.errorText}>{error}{'\n\n'}Apply the GamerHub migration in supabase/migrations, then refresh.</Text></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'Overview' && <>
          <View style={styles.welcome}><Text style={styles.welcomeTitle}>Hub status</Text><Text style={styles.welcomeSub}>Live operations at a glance</Text><View style={styles.welcomeStats}><Text style={styles.welcomeStat}>{availableStations}<Text style={styles.welcomeUnit}> available</Text></Text><Text style={styles.welcomeStat}>{activeSessions.length}<Text style={styles.welcomeUnit}> active sessions</Text></Text></View></View>
          <View style={styles.metricGrid}><Metric label="Stations" value={String(stations.length)} icon="desktop-outline" /><Metric label="Open issues" value={String(openIssues)} icon="construct-outline" /><Metric label="Orders today" value={String(report?.orders_today ?? orders.filter(order => new Date(order.created_at).toDateString() === new Date().toDateString()).length)} icon="receipt-outline" /><Metric label="Verified revenue" value={`₱${revenue.toLocaleString('en-PH')}`} icon="cash-outline" /></View>
          <SectionTitle title="Needs attention" /><RowCard title={`${reservations.filter(item => item.status === 'PENDING_PAYMENT').length} pending payments`} subtitle="Verify received payments before activation" icon="card-outline" onPress={() => setTab('Sessions')} />
          <RowCard title={`${orders.filter(item => item.status === 'PLACED' || item.status === 'PREPARING').length} orders in progress`} subtitle="Update preparation and pickup status" icon="fast-food-outline" onPress={() => setTab('Orders')} />
          <RowCard title={`${openIssues} maintenance reports`} subtitle="Review stations that need attention" icon="construct-outline" onPress={() => setTab('Maintenance')} />
          <Text style={styles.note}>Payment collection happens through your configured provider or at the counter. This console records staff verification; it does not charge a card or e-wallet.</Text>
        </>}
        {tab === 'Stations' && <><SectionTitle title="Station management" subtitle="Tap a station’s status to set Available, Reserved, or Maintenance. Changes sync to the gamer station list." />{stations.map(station => <View key={station.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.stationGlyph}><Ionicons name="desktop-outline" size={21} color={COLORS.cyan} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{station.name}</Text><Text style={styles.cardSub}>{station.station_type} · ₱{station.hourly_rate}/hour</Text></View><StatusPill status={station.status} onPress={station.status === 'OCCUPIED' ? undefined : () => setStationStatus(station)} /></View><Text style={styles.spec}>{[station.processor, station.gpu, station.ram].filter(Boolean).join(' · ')}</Text>{station.status === 'OCCUPIED' ? <Text style={styles.cardSub}>End the active session before changing this station.</Text> : <Pressable onPress={() => setStationStatus(station)} style={styles.smallAction}><Text style={styles.smallActionText}>Choose station status</Text></Pressable>}</View>)}</>}
        {tab === 'Sessions' && <><SectionTitle title="Reservations & payments" subtitle="Verify counter payments and activate confirmed reservations" /><Text style={styles.subsection}>PAYMENTS TO VERIFY</Text>{payments.filter(item => item.status === 'PENDING').map(payment => <View key={payment.id} style={styles.card}><Text style={styles.cardTitle}>₱{Number(payment.amount).toFixed(2)} · {payment.method}</Text><Text style={styles.cardSub}>{payment.reservation_id ? 'Reservation' : payment.session_id ? 'Playtime extension' : payment.order_id ? `Food order · ${payment.order_id.slice(0, 8)}` : 'Payment'} · Ref {payment.id.slice(0, 8)}</Text>{payment.method === 'PayPal' ? <Text style={styles.note}>PayPal is verified automatically. Ask the customer to retry verification; never mark it paid manually.</Text> : <Pressable onPress={() => markPaymentVerified(payment)} style={styles.smallAction}><Text style={styles.smallActionText}>Confirm received payment</Text></Pressable>}</View>)}{!payments.some(item => item.status === 'PENDING') && <Empty label="No pending payments" />}<Text style={styles.subsection}>CONFIRMED RESERVATIONS</Text>{reservations.filter(item => item.status === 'CONFIRMED').map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.stations?.name ?? item.station_id} · {item.profiles?.email ?? 'Customer'}</Text><Text style={styles.cardSub}>{new Date(item.start_at).toLocaleString()} · ₱{Number(item.total_amount).toFixed(2)}</Text><TextInput value={enteredPins[item.id] ?? ''} onChangeText={value => setEnteredPins(current => ({ ...current, [item.id]: value.replace(/\D/g, '').slice(0, 6) }))} placeholder="Enter customer 6-digit PIN" placeholderTextColor={COLORS.muted} keyboardType="number-pad" maxLength={6} style={styles.issueInput} /><Pressable onPress={() => activate(item)} style={styles.smallAction}><Text style={styles.smallActionText}>Verify PIN & activate</Text></Pressable></View>)}{!reservations.some(item => item.status === 'CONFIRMED') && <Empty label="No confirmed reservations waiting for activation" />}</>}
        {tab === 'Active Sessions' && <>
          <SectionTitle title="Active sessions" subtitle="Live timers for gamers currently using a station" />
          {activeSessions.map(item => <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{item.stations?.name ?? stationName(item.station_id)}</Text><Text style={styles.cardSub}>{item.profiles?.email ?? 'Customer'}</Text></View><StatusPill status={item.status} /></View>
            <Text style={styles.cardSub}>Started {new Date(item.started_at).toLocaleTimeString()} · Ends {new Date(item.ends_at).toLocaleTimeString()}</Text>
            <SessionCountdown endsAt={item.ends_at} />
            <Pressable onPress={() => endSession(item)} style={[styles.smallAction, styles.dangerAction]}><Text style={[styles.smallActionText, styles.dangerText]}>End session</Text></Pressable>
          </View>)}
          {!activeSessions.length && awaitingActivation.length === 0 && <Empty label="No active sessions. A session appears here after staff verifies payment and activates the gamer’s PIN." />}
          {!!awaitingActivation.length && <>
            <SectionTitle title="Paid reservations · ready to start" subtitle="When the gamer arrives, enter the six-digit PIN they show you. This starts their countdown." />
            {awaitingActivation.map(item => <View key={item.id} style={styles.card}>
              <View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{item.stations?.name ?? stationName(item.station_id)}</Text><Text style={styles.cardSub}>{item.profiles?.email ?? 'Customer'}</Text></View><StatusPill status="CONFIRMED" /></View>
              <Text style={styles.cardSub}>{new Date(item.start_at).toLocaleString()} · {new Date(item.ends_at).toLocaleTimeString()} · ₱{Number(item.total_amount).toFixed(2)}</Text>
              <TextInput
                value={enteredPins[item.id] ?? ''}
                onChangeText={value => setEnteredPins(current => ({ ...current, [item.id]: value.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="Enter gamer’s 6-digit PIN"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.issueInput}
              />
              <Pressable onPress={() => activate(item)} style={styles.smallAction}>
                <Text style={styles.smallActionText}>Verify PIN & start timer</Text>
              </Pressable>
            </View>)}
          </>}
        </>}
        {tab === 'Transfers' && <>
          <SectionTitle title="Computer transfer requests" subtitle="Review gamer requests and see previous decisions" />
          <Text style={styles.subsection}>PENDING REQUESTS · {pendingTransfers.length}</Text>
          {pendingTransfers.map(item => <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{stationName(item.from_station_id)} → {stationName(item.to_station_id)}</Text><Text style={styles.cardSub}>{item.profiles?.email ?? 'Gamer'} · {new Date(item.created_at).toLocaleString()}</Text></View><StatusPill status={item.status} /></View>
            <Text style={styles.cardSub}>{item.reason || 'No reason provided'}</Text>
            <View style={styles.actionRow}><Pressable onPress={() => void mutate(() => supabase.rpc('resolve_gamerhub_transfer_request', { p_request_id: item.id, p_approve: true }), 'Station transfer approved.')} style={styles.smallAction}><Text style={styles.smallActionText}>Approve transfer</Text></Pressable><Pressable onPress={() => void mutate(() => supabase.rpc('resolve_gamerhub_transfer_request', { p_request_id: item.id, p_approve: false }), 'Station transfer declined.')} style={[styles.smallAction, styles.dangerAction]}><Text style={[styles.smallActionText, styles.dangerText]}>Decline</Text></Pressable></View>
          </View>)}
          {!pendingTransfers.length && <Empty label="No pending requests. Gamers can request a move from their active session screen." />}
          {!!transferHistory.length && <>
            <SectionTitle title="Recent decisions" subtitle="Approved, declined, or cancelled transfer requests" />
            {transferHistory.map(item => <View key={item.id} style={styles.card}>
              <View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{stationName(item.from_station_id)} → {stationName(item.to_station_id)}</Text><Text style={styles.cardSub}>{item.profiles?.email ?? 'Gamer'} · {new Date(item.created_at).toLocaleString()}</Text></View><StatusPill status={item.status} /></View>
              {item.reason ? <Text style={styles.cardSub}>{item.reason}</Text> : null}
            </View>)}
          </>}
        </>}
        {tab === 'Orders' && <><SectionTitle title="Orders & payments" subtitle="Track fulfillment and verify payment records" />{orders.map(order => { const orderPayment = payments.find(item => item.order_id === order.id); const paid = orderPayment?.status === 'PAID'; const nextStatuses = order.status === 'PLACED' ? (paid ? ['PREPARING'] : ['PREPARING', 'CANCELLED']) : order.status === 'PREPARING' ? (paid ? ['READY'] : ['READY', 'CANCELLED']) : order.status === 'READY' ? ['COMPLETED'] : []; return <View key={order.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>Order {order.id.slice(0, 8)}</Text><Text style={styles.cardSub}>{order.profiles?.email ?? 'Customer'} · {new Date(order.created_at).toLocaleTimeString()}</Text></View><Text style={styles.money}>₱{Number(order.total_amount).toFixed(2)}</Text></View><Text style={styles.cardSub}>Payment: {orderPayment ? `${orderPayment.method} · ${orderPayment.status}` : 'Not recorded'}</Text>{order.order_items?.map((item: Row, index: number) => <Text key={`${order.id}-${index}`} style={styles.cardSub}>{item.food_items?.name ?? 'Menu item'} × {item.quantity}</Text>)}<View style={styles.actionRow}>{nextStatuses.map(next => <Pressable key={next} onPress={() => changeOrder(order, next)} style={[styles.smallAction, next === 'CANCELLED' && styles.dangerAction]}><Text style={[styles.smallActionText, next === 'CANCELLED' && styles.dangerText]}>{next === 'COMPLETED' ? 'Mark picked up' : next === 'CANCELLED' ? 'Cancel' : `Mark ${next.toLowerCase()}`}</Text></Pressable>)}<StatusPill status={order.status} /></View></View>; })}{!orders.length && <Empty label="No orders yet" />}</>}
        {tab === 'Maintenance' && <><SectionTitle title="Maintenance" subtitle="Log issues on free stations and track repairs" /><TextInput value={issue} onChangeText={setIssue} placeholder="Describe the problem" placeholderTextColor={COLORS.muted} style={styles.issueInput} /><Text style={styles.subsection}>AVAILABLE OR ALREADY FLAGGED</Text>{stations.filter(station => station.status === 'AVAILABLE' || station.status === 'MAINTENANCE').map(station => <Pressable key={station.id} onPress={() => void reportMaintenance(station)} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{station.name}</Text><Text style={styles.cardSub}>{station.status}</Text></View><Ionicons name="add-circle-outline" size={20} color="#C58AFF" /></View></Pressable>)}<Text style={styles.subsection}>OPEN MAINTENANCE</Text>{maintenance.filter(item => item.status !== 'RESOLVED').map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.stations?.name ?? item.station_id}</Text><Text style={styles.cardSub}>{item.issue}</Text><Text style={styles.cardSub}>{item.status} · {new Date(item.created_at).toLocaleDateString()}</Text><View style={styles.actionRow}>{item.status === 'OPEN' && <Pressable onPress={() => void mutate(() => supabase.rpc('manage_gamerhub_maintenance', { p_station_id: item.station_id, p_action: 'START', p_issue: null, p_record_id: item.id }), 'Repair marked in progress.')} style={styles.smallAction}><Text style={styles.smallActionText}>Start repair</Text></Pressable>}<Pressable onPress={() => void mutate(() => supabase.rpc('manage_gamerhub_maintenance', { p_station_id: item.station_id, p_action: 'RESOLVE', p_issue: null, p_record_id: item.id }), 'Issue marked resolved.')} style={styles.smallAction}><Text style={styles.smallActionText}>Mark resolved</Text></Pressable></View></View>)}</>}
        {tab === 'Transactions' && <><SectionTitle title="Transactions" subtitle="Every payment record from reservations, sessions, and food orders" />{payments.map(payment => <View key={payment.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>₱{Number(payment.amount).toFixed(2)} · {payment.method}</Text><Text style={styles.cardSub}>{payment.reservation_id ? 'Station reservation' : payment.session_id ? 'Playtime extension' : payment.order_id ? `Food order ${payment.order_id.slice(0, 8)}` : 'Payment'} · {new Date(payment.created_at).toLocaleString()}</Text></View><StatusPill status={payment.status} /></View>{payment.provider_reference ? <Text style={styles.cardSub}>Reference {payment.provider_reference}</Text> : null}</View>)}{!payments.length && <Empty label="No transactions recorded yet" />}</>}
        {tab === 'Customers' && <><SectionTitle title="Customers" subtitle="Gamer accounts connected to this hub" />{customers.map(customer => <View key={customer.id} style={styles.card}><View style={styles.cardHeader}><View style={styles.flex}><Text style={styles.cardTitle}>{[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username}</Text><Text style={styles.cardSub}>{customer.email}</Text><Text style={styles.cardSub}>@{customer.username} · Joined {new Date(customer.created_at).toLocaleDateString()}</Text></View><StatusPill status={customer.role.toUpperCase()} /></View></View>)}{!customers.length && <Empty label="No customer accounts found" />}</>}
        {tab === 'Reports' && <><SectionTitle title="Usage & revenue" subtitle="All-time totals and session starts by hour from the Supabase database" />{reportError ? <View style={styles.errorBox}><Text style={styles.errorText}>Full-history report is unavailable. Apply supabase/migrations/20261109_gamerhub_maintenance_reporting.sql, then refresh.{`\n`}{reportError}</Text></View> : null}<View style={styles.reportCard}><Text style={styles.cardTitle}>Verified revenue</Text><Text style={styles.reportValue}>₱{revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</Text><Text style={styles.cardSub}>{report?.paid_transactions ?? payments.filter(item => item.status === 'PAID').length} verified payment records</Text></View><View style={styles.reportCard}><Text style={styles.cardTitle}>Station utilization</Text><View style={styles.utilization}><Text style={styles.utilValue}>{stations.length ? Math.round((activeSessions.length / stations.length) * 100) : 0}%</Text><Text style={styles.cardSub}>{activeSessions.length} active of {stations.length} stations</Text></View></View><View style={styles.reportCard}><Text style={styles.cardTitle}>Peak session start hours · all time</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chart}>{hourlyUsage.map(item => <View key={item.hour} style={styles.chartCol}><Text style={styles.chartValue}>{item.count || ''}</Text><View style={[styles.bar, { height: Math.max(4, item.count / maxUsage * 74) }]} /><Text style={styles.chartLabel}>{item.hour}</Text></View>)}</View></ScrollView></View><View style={styles.metricGrid}><Metric label="Sessions logged" value={String(report?.sessions_total ?? sessions.length)} icon="timer-outline" /><Metric label="Completed orders" value={String(report?.completed_orders ?? orders.filter(item => item.status === 'COMPLETED').length)} icon="checkmark-done-outline" /></View></>}
      </ScrollView>}
      <AdminWorkspaceBottomNav selected={tab} onSelect={item => selectTab(item === 'Home' ? 'Overview' : item === 'Sessions' ? 'Active Sessions' : item === 'More' ? 'Reports' : item)} />
    </SafeAreaView>
  );
}

function AdminWorkspaceBottomNav({ selected, onSelect }: { selected: Tab; onSelect: (item: 'Home' | 'Stations' | 'Sessions' | 'Orders' | 'More') => void }) {
  const items: { label: 'Home' | 'Stations' | 'Sessions' | 'Orders' | 'More'; icon: React.ComponentProps<typeof Ionicons>['name']; tab: Tab }[] = [
    { label: 'Home', icon: 'home-outline', tab: 'Overview' },
    { label: 'Stations', icon: 'desktop-outline', tab: 'Stations' },
    { label: 'Sessions', icon: 'game-controller-outline', tab: 'Active Sessions' },
    { label: 'Orders', icon: 'receipt-outline', tab: 'Orders' },
    { label: 'More', icon: 'grid-outline', tab: 'Reports' },
  ];
  return <View style={styles.bottomNav}>{items.map(item => {
    const active = selected === item.tab || (item.label === 'More' && ['Transfers', 'Maintenance', 'Transactions', 'Customers', 'Reports'].includes(selected));
    return <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`Admin ${item.label}`} accessibilityState={{ selected: active }} onPress={() => onSelect(item.label)} style={styles.bottomNavItem}><Ionicons name={item.icon} size={20} color={active ? COLORS.primary : COLORS.muted} /><Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{item.label}</Text></Pressable>;
  })}</View>;
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ComponentProps<typeof Ionicons>['name'] }) {
  return <View style={styles.metric}><Ionicons name={icon} size={17} color="#C58AFF" /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text>{subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}</View>; }
function StatusPill({ status, onPress }: { status: string; onPress?: () => void }) { const color = status === 'AVAILABLE' || status === 'PAID' || status === 'COMPLETED' || status === 'READY' ? '#59E6AA' : status === 'MAINTENANCE' || status === 'PENDING' || status === 'PENDING_PAYMENT' ? '#FFC56E' : '#C58AFF'; const content = <><Text style={[styles.pillText, { color }]}>{status.replace('_', ' ')}</Text>{onPress ? <Ionicons name="chevron-down" size={11} color={color} style={{ marginLeft: 4 }} /> : null}</>; return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Change ${status.toLowerCase()} station status`} onPress={onPress} style={[styles.pill, { backgroundColor: `${color}20`, flexDirection: 'row', alignItems: 'center' }]}>{content}</Pressable> : <View style={[styles.pill, { backgroundColor: `${color}20` }]}>{content}</View>; }
function RowCard({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) { return <Pressable style={styles.card} onPress={onPress}><View style={styles.cardHeader}><Ionicons name={icon} size={21} color="#C58AFF" /><View style={styles.rowCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSub}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={16} color={COLORS.muted} /></View></Pressable>; }
function Empty({ label }: { label: string }) { return <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={22} color="#59E6AA" /><Text style={styles.muted}>{label}</Text></View>; }
function SessionCountdown({ endsAt }: { endsAt: string }) { const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000))); useEffect(() => { const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000))), 1000); return () => clearInterval(timer); }, [endsAt]); return <Text style={styles.countdown}>Remaining {String(Math.floor(seconds / 3600)).padStart(2, '0')}:{String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, topBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, headerBack: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface }, headerCopy: { flex: 1 }, kicker: { color: '#C58AFF', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 }, header: { color: COLORS.white, fontSize: 22, fontWeight: '800', marginTop: 4 }, refresh: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, position: 'relative' }, notificationBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#E94B78', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.background, paddingHorizontal: 3 }, notificationBadgeText: { color: COLORS.white, fontSize: 8, fontWeight: '900' }, reservationNotice: { marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 13, backgroundColor: '#24172F', borderWidth: 1, borderColor: '#70459A', flexDirection: 'row', alignItems: 'center', gap: 10 }, noticeIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#382047', alignItems: 'center', justifyContent: 'center' }, noticeCopy: { flex: 1 }, noticeTitle: { color: '#EAD9F8', fontSize: 10, fontWeight: '800' }, noticeSub: { color: COLORS.muted, fontSize: 9, marginTop: 4, lineHeight: 14 }, tabScroller: { height: 49, flexGrow: 0, flexShrink: 0, marginBottom: 5 }, tabs: { height: 42, alignItems: 'center', paddingHorizontal: 18, gap: 7 }, tab: { height: 36, minWidth: 67, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border }, tabActive: { backgroundColor: '#42205D', borderColor: '#7541A0' }, tabText: { color: COLORS.muted, fontWeight: '700', fontSize: 9 }, tabTextActive: { color: '#E1C5FF' }, content: { paddingHorizontal: 18, paddingBottom: 24 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }, muted: { color: COLORS.muted, fontSize: 11, textAlign: 'center', lineHeight: 17 }, errorBox: { margin: 18, padding: 16, gap: 10, backgroundColor: '#31271A', borderRadius: 14 }, errorText: { color: '#F4D9A6', fontSize: 11, lineHeight: 18 }, welcome: { backgroundColor: '#29133B', borderColor: '#4B2863', borderWidth: 1, borderRadius: 19, padding: 17 }, welcomeTitle: { color: COLORS.white, fontWeight: '800', fontSize: 17 }, welcomeSub: { color: '#CAB4D8', fontSize: 10, marginTop: 4 }, welcomeStats: { flexDirection: 'row', gap: 20, marginTop: 18 }, welcomeStat: { color: '#D7B0FF', fontSize: 20, fontWeight: '800' }, welcomeUnit: { color: '#CAB4D8', fontSize: 9, fontWeight: '500' }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 }, metric: { width: '48%', minHeight: 95, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 12, justifyContent: 'space-between' }, metricValue: { color: COLORS.white, fontWeight: '800', fontSize: 17, marginTop: 6 }, metricLabel: { color: COLORS.muted, fontSize: 9 }, sectionTitle: { marginTop: 9, marginBottom: 13 }, sectionHeading: { color: COLORS.white, fontSize: 16, fontWeight: '800' }, sectionSub: { color: COLORS.muted, fontSize: 10, marginTop: 4, lineHeight: 15 }, card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#292934', borderRadius: 15, padding: 12, marginBottom: 9 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stationGlyph: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#122534', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, rowCopy: { flex: 1, marginHorizontal: 10 }, cardTitle: { color: COLORS.white, fontSize: 11, fontWeight: '800' }, cardSub: { color: COLORS.muted, fontSize: 9, marginTop: 4 }, spec: { color: COLORS.muted, fontSize: 9, marginTop: 10 }, pill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9 }, pillText: { fontSize: 7, fontWeight: '800' }, smallAction: { alignSelf: 'flex-start', marginTop: 11, borderWidth: 1, borderColor: '#70459A', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 }, smallActionText: { color: '#D6B4F4', fontSize: 9, fontWeight: '800' }, subsection: { color: '#BB9BD4', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 14, marginBottom: 8 }, pin: { color: '#66E1C3', fontSize: 16, fontWeight: '900', letterSpacing: 2, marginTop: 10 }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 4 }, dangerAction: { borderColor: '#8F3548' }, dangerText: { color: '#FF9AAE' }, money: { color: '#D7B0FF', fontWeight: '800', fontSize: 11 }, issueInput: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, color: COLORS.white, fontSize: 11 }, empty: { padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, note: { color: COLORS.muted, fontSize: 9, lineHeight: 15, marginTop: 13, marginBottom: 10 }, reportCard: { backgroundColor: COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, padding: 15, marginBottom: 10 }, reportValue: { color: '#D7B0FF', fontSize: 27, fontWeight: '900', marginTop: 9 }, utilization: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }, utilValue: { color: '#69DDBE', fontSize: 29, fontWeight: '900' }, chart: { height: 125, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginTop: 15 }, chartCol: { alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }, chartValue: { height: 12, color: '#D7B0FF', fontSize: 8 }, bar: { width: 15, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: '#9D53DB' }, chartLabel: { color: COLORS.muted, fontSize: 8 }, countdown: { color: '#67E2BE', fontSize: 12, fontWeight: '800', marginTop: 8 }, denied: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, deniedIcon: { width: 62, height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#322140', marginBottom: 18 }, title: { color: COLORS.white, fontSize: 20, fontWeight: '800', marginBottom: 8 }, primaryButton: { backgroundColor: COLORS.primary, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 12, marginTop: 20 }, primaryText: { color: COLORS.white, fontSize: 11, fontWeight: '800' }, bottomNav: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: '#59366F', paddingHorizontal: 5 }, bottomNavItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 }, bottomNavLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '600' }, bottomNavLabelActive: { color: COLORS.primary, fontWeight: '800' },
});
