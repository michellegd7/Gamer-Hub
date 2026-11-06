import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';

type Metrics = {
  stations: number;
  available: number;
  reserved: number;
  occupied: number;
  maintenance: number;
  activeSessions: number;
  pendingReservations: number;
  activeOrders: number;
  pendingPayments: number;
  revenueToday: number;
};

const emptyMetrics: Metrics = {
  stations: 0,
  available: 0,
  reserved: 0,
  occupied: 0,
  maintenance: 0,
  activeSessions: 0,
  pendingReservations: 0,
  activeOrders: 0,
  pendingPayments: 0,
  revenueToday: 0,
};

export default function AdminDashboard() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [databaseConnected, setDatabaseConnected] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [newReservationCount, setNewReservationCount] = useState(0);
  const [latestReservationNotice, setLatestReservationNotice] = useState<Record<string, any> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const logout = async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      Alert.alert('Could not log out', signOutError.message);
      return;
    }
    router.replace('/');
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const [stations, sessions, reservations, orders, pendingPayments, paidToday] = await Promise.all([
        supabase.rpc('get_gamerhub_station_availability'),
        supabase.from('sessions').select('id,status').eq('status', 'ACTIVE'),
        supabase.from('reservations').select('id,status').in('status', ['PENDING_PAYMENT', 'CONFIRMED']),
        supabase.from('orders').select('id,status').in('status', ['PLACED', 'PREPARING', 'READY']),
        supabase.from('payments').select('id,status').eq('status', 'PENDING'),
        supabase.from('payments').select('amount').eq('status', 'PAID').gte('created_at', today.toISOString()),
      ]);
      const failed = [stations, sessions, reservations, orders, pendingPayments, paidToday].find(result => result.error);
      if (failed?.error) throw failed.error;

      const stationRows = (stations.data ?? []) as { id: string; status: string }[];
      setMetrics({
        stations: stationRows.length,
        available: stationRows.filter(row => row.status === 'AVAILABLE').length,
        reserved: stationRows.filter(row => row.status === 'RESERVED').length,
        occupied: stationRows.filter(row => row.status === 'OCCUPIED').length,
        maintenance: stationRows.filter(row => row.status === 'MAINTENANCE').length,
        activeSessions: sessions.data?.length ?? 0,
        pendingReservations: reservations.data?.length ?? 0,
        activeOrders: orders.data?.length ?? 0,
        pendingPayments: pendingPayments.data?.length ?? 0,
        revenueToday: (paidToday.data ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0),
      });
      setDatabaseConnected(true);
      setError('');
    } catch (loadError) {
      setDatabaseConnected(false);
      setError(loadError instanceof Error ? loadError.message : 'Could not read GamerHub data from Supabase. Check the project URL, network, and database policies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = user
        ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
        : { data: null };
      if (!mounted) return;
      const allowed = data?.role === 'admin';
      setIsAdmin(allowed);
      setChecking(false);
      if (allowed) void loadDashboard();
    };
    void checkAdmin();
    return () => { mounted = false; };
  }, [loadDashboard]);

  useEffect(() => {
    if (!isAdmin) return;
    const refreshTimer = setInterval(() => void loadDashboard(), 15000);
    return () => clearInterval(refreshTimer);
  }, [isAdmin, loadDashboard]);

  useEffect(() => {
    if (!isAdmin) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel(`admin-dashboard-reservations-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservations' }, payload => {
        setLatestReservationNotice(payload.new as Record<string, any>);
        setNewReservationCount(count => count + 1);
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void loadDashboard(), 250);
      })
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, loadDashboard]);

  const openReservations = () => {
    setNewReservationCount(0);
    setLatestReservationNotice(null);
    router.push({ pathname: '/admin-workspace', params: { tab: 'Sessions' } } as any);
  };

  if (checking) {
    return <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Checking administrator access…</Text></View>;
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <View style={styles.deniedIcon}><Ionicons name="lock-closed" size={27} color="#D6B4F4" /></View>
          <Text style={styles.title}>Administrator access required</Text>
          <Text style={styles.muted}>Sign in with a GamerHub account assigned the admin role to open this dashboard.</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace('/(tabs)/profile' as any)}><Text style={styles.primaryText}>Back to profile</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/(tabs)/profile' as any)} style={styles.iconButton} accessibilityLabel="Return to profile"><Ionicons name="arrow-back" size={20} color={COLORS.white} /></Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>GAMERHUB · MANAGEMENT</Text>
          <Text style={styles.title}>Control center</Text>
        </View>
        <Pressable onPress={openReservations} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`${newReservationCount ? `${newReservationCount} new reservations. ` : ''}Open reservations`}><Ionicons name="notifications-outline" size={18} color={newReservationCount ? '#C58AFF' : COLORS.white} />{newReservationCount > 0 && <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{newReservationCount > 9 ? '9+' : newReservationCount}</Text></View>}</Pressable>
        <Pressable onPress={() => void loadDashboard()} style={styles.iconButton} accessibilityLabel="Refresh dashboard"><Ionicons name="refresh" size={18} color={COLORS.white} /></Pressable>
        <Pressable onPress={() => void logout()} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Log out of admin account"><Ionicons name="log-out-outline" size={19} color="#FF9AAE" /></Pressable>
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.connectionCard}>
          <View style={styles.connectionIcon}><Ionicons name="cloud-done-outline" size={20} color="#75DDB8" /></View>
          <View style={styles.connectionCopy}>
            <Text style={[styles.connectionTitle, databaseConnected === false && styles.connectionTitleOffline]}>
              {databaseConnected === false ? 'Database connection unavailable' : databaseConnected ? 'Gamer app connected' : 'Connecting to GamerHub database…'}
            </Text>
            <Text style={styles.connectionSub}>
              {databaseConnected === false ? 'Admin and gamer data cannot refresh until Supabase is reachable.' : 'Admin and gamer screens read and update the same Supabase data.'}
            </Text>
          </View>
          {loading ? <ActivityIndicator size="small" color={databaseConnected === false ? '#FF8797' : '#75DDB8'} /> : <View style={[styles.liveDot, databaseConnected === false && styles.offlineDot]} />}
        </View>

        {latestReservationNotice && <Pressable onPress={openReservations} style={styles.reservationNotice} accessibilityRole="button" accessibilityLabel="New station reservation received. Open reservation details"><View style={styles.noticeIcon}><Ionicons name="desktop-outline" size={18} color="#D6B4F4" /></View><View style={styles.noticeCopy}><Text style={styles.noticeTitle}>New station reservation</Text><Text style={styles.noticeSub}>{latestReservationNotice.station_id ?? 'A station'} · Tap to review reservation and payment</Text></View><Ionicons name="chevron-forward" size={18} color="#D6B4F4" /></Pressable>}

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#F4D9A6" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadDashboard()}><Text style={styles.retry}>Retry</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.revenueCard}>
          <View style={styles.revenueTop}>
            <View><Text style={styles.revenueLabel}>TODAY’S REVENUE</Text><Text style={styles.revenueValue}>₱{metrics.revenueToday.toFixed(2)}</Text></View>
            <View style={styles.revenueIcon}><Ionicons name="trending-up" size={20} color="#8CE2C3" /></View>
          </View>
          <View style={styles.revenueDivider} />
          <Text style={styles.revenueFootnote}>Verified payments recorded today</Text>
        </View>

        <Text style={styles.sectionTitle}>TODAY’S OVERVIEW</Text>
        <View style={styles.grid}>
          <Metric icon="checkmark-circle-outline" label="Available stations" value={metrics.available} color="#67DDB8" />
          <Metric icon="calendar-outline" label="Reserved stations" value={metrics.reserved} color="#C58AFF" />
          <Metric icon="desktop-outline" label="Stations in use" value={metrics.occupied} color="#D6B4F4" />
          <Metric icon="game-controller-outline" label="Active sessions" value={metrics.activeSessions} color={COLORS.cyan} />
          <Metric icon="receipt-outline" label="Orders in progress" value={metrics.activeOrders} color="#FFB86B" />
        </View>

        <View style={styles.occupancyCard}>
          <View style={styles.occupancyTop}><View><Text style={styles.cardTitle}>Station availability</Text><Text style={styles.cardSub}>{metrics.available} of {metrics.stations} stations ready</Text></View><Text style={styles.occupancyCount}>{metrics.occupied} in use</Text></View>
          <View style={styles.statusTrack}>
            {metrics.stations > 0 ? <>
              {!!metrics.available && <View style={[styles.statusSegment, styles.statusAvailable, { width: `${(metrics.available / metrics.stations) * 100}%` }]} />}
              {!!metrics.reserved && <View style={[styles.statusSegment, styles.statusReserved, { width: `${(metrics.reserved / metrics.stations) * 100}%` }]} />}
              {!!metrics.occupied && <View style={[styles.statusSegment, styles.statusOccupied, { width: `${(metrics.occupied / metrics.stations) * 100}%` }]} />}
              {!!metrics.maintenance && <View style={[styles.statusSegment, styles.statusMaintenance, { width: `${(metrics.maintenance / metrics.stations) * 100}%` }]} />}
            </> : null}
          </View>
          <View style={styles.legend}><Legend color="#67DDB8" text={`Available ${metrics.available}`} /><Legend color="#C58AFF" text={`Reserved ${metrics.reserved}`} /><Legend color="#D6B4F4" text={`Occupied ${metrics.occupied}`} /><Legend color="#FF8797" text={`Maintenance ${metrics.maintenance}`} /></View>
        </View>

        <Text style={styles.sectionTitle}>ADMIN TASKS</Text>
        <View style={styles.tasksCard}>
          <Action icon="desktop-outline" title="Stations" subtitle="Update availability; gamers see the change." onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Stations' } } as any)} />
          <Action icon="game-controller-outline" title="Reservations & payments" subtitle={`${metrics.pendingReservations} reservations · ${metrics.pendingPayments} payments to review`} onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Sessions' } } as any)} />
          <Action icon="timer-outline" title="Active sessions" subtitle={`${metrics.activeSessions} sessions currently running`} onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Active Sessions' } } as any)} />
          <Action icon="fast-food-outline" title="Food & drink orders" subtitle="Update order progress for gamers." onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Orders' } } as any)} />
          <Action icon="swap-horizontal-outline" title="Transfer requests" subtitle="Review gamers’ station change requests." onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Transfers' } } as any)} />
          <Action icon="construct-outline" title="Maintenance" subtitle={`${metrics.maintenance} stations currently out of service`} onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Maintenance' } } as any)} />
          <Action icon="people-outline" title="Customer accounts" subtitle="View gamer account details and roles." onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Customers' } } as any)} />
          <Action icon="card-outline" title="Transactions" subtitle="Review payment status and provider references." onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Transactions' } } as any)} />
          <Action icon="bar-chart-outline" title="Usage & revenue reports" subtitle="Review sessions, earnings, and peak hours" onPress={() => router.push({ pathname: '/admin-workspace', params: { tab: 'Reports' } } as any)} last />
        </View>
        <Text style={styles.footerNote}>Changes are saved to Supabase and appear in the gamer app as it refreshes.</Text>
      </ScrollView>
      <AdminBottomNav
        onSelect={item => {
          if (item === 'Home') {
            scrollRef.current?.scrollTo({ y: 0, animated: true });
            return;
          }
          const tab = item === 'More' ? 'Reports' : item === 'Sessions' ? 'Active Sessions' : item;
          router.push({ pathname: '/admin-workspace', params: { tab } } as any);
        }}
      />
    </SafeAreaView>
  );
}

function Metric({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string | number; color: string }) {
  return <View style={styles.metric}><View style={[styles.metricIcon, { backgroundColor: `${color}1A` }]}><Ionicons name={icon} size={17} color={color} /></View><View style={styles.metricCopy}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View></View>;
}

function Legend({ color, text }: { color: string; text: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{text}</Text></View>;
}

function Action({ icon, title, subtitle, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; onPress: () => void; last?: boolean }) {
  return <Pressable style={[styles.action, last && styles.actionLast]} onPress={onPress}><View style={styles.actionIcon}><Ionicons name={icon} size={18} color="#D6B4F4" /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionSub}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={16} color={COLORS.muted} /></Pressable>;
}

function AdminBottomNav({ onSelect }: { onSelect: (item: 'Home' | 'Stations' | 'Sessions' | 'Orders' | 'More') => void }) {
  const items: { label: 'Home' | 'Stations' | 'Sessions' | 'Orders' | 'More'; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'Home', icon: 'home-outline' },
    { label: 'Stations', icon: 'desktop-outline' },
    { label: 'Sessions', icon: 'game-controller-outline' },
    { label: 'Orders', icon: 'receipt-outline' },
    { label: 'More', icon: 'grid-outline' },
  ];
  return <View style={styles.bottomNav}>{items.map((item, index) => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`Admin ${item.label}`} onPress={() => onSelect(item.label)} style={styles.bottomNavItem}><Ionicons name={item.icon} size={20} color={index === 0 ? COLORS.primary : COLORS.muted} /><Text style={[styles.bottomNavLabel, index === 0 && styles.bottomNavLabelActive]}>{item.label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  header: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  iconButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, position: 'relative' },
  notificationBadge: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#E94B78', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.background, paddingHorizontal: 3 },
  notificationBadgeText: { color: COLORS.white, fontSize: 8, fontWeight: '900' },
  headerCopy: { flex: 1 }, kicker: { color: '#C58AFF', fontSize: 9, fontWeight: '800', letterSpacing: 1.35 },
  title: { color: COLORS.white, fontSize: 21, fontWeight: '800', marginTop: 3, textAlign: 'left' },
  content: { paddingHorizontal: 17, paddingBottom: 36 },
  connectionCard: { backgroundColor: '#14221E', borderWidth: 1, borderColor: '#2D5144', borderRadius: 15, padding: 13, marginBottom: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  reservationNotice: { backgroundColor: '#24172F', borderWidth: 1, borderColor: '#70459A', borderRadius: 14, padding: 12, marginBottom: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: '#382047', alignItems: 'center', justifyContent: 'center' },
  noticeCopy: { flex: 1 }, noticeTitle: { color: '#EAD9F8', fontSize: 10, fontWeight: '800' }, noticeSub: { color: COLORS.muted, fontSize: 9, marginTop: 4, lineHeight: 14 },
  connectionIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#20382F', alignItems: 'center', justifyContent: 'center' }, connectionCopy: { flex: 1 }, connectionTitle: { color: '#B7F0D9', fontSize: 11, fontWeight: '800' }, connectionTitleOffline: { color: '#FFACB7' }, connectionSub: { color: '#A3B9AE', fontSize: 9, lineHeight: 13, marginTop: 3 }, liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#67DDB8' }, offlineDot: { backgroundColor: '#FF8797' },
  sectionTitle: { color: '#B8B8C4', fontSize: 9, fontWeight: '900', letterSpacing: 1.25, marginTop: 19, marginBottom: 10 },
  revenueCard: { backgroundColor: '#171D20', borderWidth: 1, borderColor: '#2B4740', borderRadius: 18, padding: 16, marginBottom: 3 },
  revenueTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, revenueLabel: { color: '#8FD9BF', fontSize: 8, fontWeight: '900', letterSpacing: 1.15 }, revenueValue: { color: COLORS.white, fontSize: 27, fontWeight: '900', letterSpacing: -0.5, marginTop: 7 }, revenueIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#20382F', alignItems: 'center', justifyContent: 'center' }, revenueDivider: { height: 1, backgroundColor: '#2C3935', marginTop: 14 }, revenueFootnote: { color: '#9AAFA6', fontSize: 9, marginTop: 9 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flex: 1, minWidth: '46%', minHeight: 76, backgroundColor: COLORS.surface, borderRadius: 15, padding: 12, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricIcon: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, metricCopy: { flex: 1 }, metricValue: { color: COLORS.white, fontSize: 18, fontWeight: '900' }, metricLabel: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  occupancyCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14, marginTop: 11 }, occupancyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, cardTitle: { color: COLORS.white, fontSize: 12, fontWeight: '800' }, cardSub: { color: COLORS.muted, fontSize: 9, marginTop: 4 }, occupancyCount: { color: '#D6B4F4', fontSize: 9, fontWeight: '800' },
  statusTrack: { height: 9, flexDirection: 'row', gap: 2, marginTop: 13, overflow: 'hidden', borderRadius: 8, backgroundColor: '#363640' }, statusSegment: { height: '100%' }, statusAvailable: { backgroundColor: '#67DDB8' }, statusReserved: { backgroundColor: '#C58AFF' }, statusOccupied: { backgroundColor: '#9A5BD1' }, statusMaintenance: { backgroundColor: '#D45C70' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 12 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 6, height: 6, borderRadius: 3 }, legendText: { color: COLORS.muted, fontSize: 8 },
  tasksCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, paddingHorizontal: 12 },
  action: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border }, actionLast: { borderBottomWidth: 0 }, actionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#342242', alignItems: 'center', justifyContent: 'center' }, actionCopy: { flex: 1 }, actionTitle: { color: COLORS.white, fontSize: 10, fontWeight: '800' }, actionSub: { color: COLORS.muted, fontSize: 8, lineHeight: 12, marginTop: 3 },
  footerNote: { color: '#777783', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 16, paddingHorizontal: 10 },
  bottomNav: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: '#59366F', paddingHorizontal: 5 },
  bottomNavItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 },
  bottomNavLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '600' }, bottomNavLabelActive: { color: COLORS.primary, fontWeight: '800' },
  muted: { color: COLORS.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 }, deniedIcon: { width: 62, height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#322140', marginBottom: 6 }, primaryButton: { backgroundColor: COLORS.primary, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 12, marginTop: 10 }, primaryText: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  errorBox: { backgroundColor: '#31271A', borderRadius: 13, padding: 12, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 8 }, errorText: { color: '#F4D9A6', fontSize: 10, flex: 1 }, retry: { color: '#E7BE73', fontSize: 10, fontWeight: '800' },
});
