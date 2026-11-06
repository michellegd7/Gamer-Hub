import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../../constants/theme';
import { fetchStations } from '../../data/gamingHub';
import { supabase } from '../../lib/supabase';
import AllSessionPinsModal from '../../components/AllSessionPinsModal';

type ActiveSessionInfo = { id: string; ends_at: string; station_id: string; stations?: { name?: string } | null };
type ReservedPlaytimeInfo = { id: string; start_at: string; ends_at: string; station_id: string; activation_pin?: string | null; total_amount?: number | string; stations?: { name?: string } | null };

const shortcuts = [
  { label: 'Reserve a seat', sub: 'Find your setup', icon: 'desktop-outline', path: '/stations', tint: '#B783FF' },
  { label: 'Food & drinks', sub: 'Order to your seat', icon: 'fast-food-outline', path: '/food', tint: '#FFC56E' },
  { label: 'My sessions', sub: 'View your activity', icon: 'time-outline', path: '/history', tint: '#70D6C2' },
  { label: 'Join the queue', sub: 'Skip the wait', icon: 'people-outline', path: '/waiting-list', tint: '#8EAEFF' },
] as const;

export default function Home() {
  const [stationList, setStationList] = useState<Awaited<ReturnType<typeof fetchStations>>>([]);
  const [availabilityError, setAvailabilityError] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSessionInfo | null>(null);
  const [reservedPlaytime, setReservedPlaytime] = useState<ReservedPlaytimeInfo | null>(null);
  const [savedTimeSeconds, setSavedTimeSeconds] = useState(0);
  const [sessionError, setSessionError] = useState('');
  const [showAllSessionsModal, setShowAllSessionsModal] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const refreshStations = async () => {
      try {
        const data = await fetchStations();
        if (mounted) { setStationList(data); setAvailabilityError(''); }
      } catch {
        if (mounted) setAvailabilityError('Live station availability could not be reached. Check your connection and try Stations again.');
      }
    };
    void refreshStations();
    channel = supabase.channel('gamer-home-station-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stations' }, () => void refreshStations())
      .subscribe();
    const timer = setInterval(() => void refreshStations(), 15000);
    return () => { mounted = false; clearInterval(timer); if (channel) void supabase.removeChannel(channel); };
  }, []);
  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    const refreshUnread = async (userId: string) => {
      const { count } = await supabase.from('user_notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false);
      if (mounted) setUnreadNotifications(count ?? 0);
    };
    const connect = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted || !user) return;
      await refreshUnread(user.id);
      if (!mounted) return;
      channel = supabase.channel(`home-notification-badge-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => void refreshUnread(user.id))
        .subscribe();
      refreshTimer = setInterval(() => void refreshUnread(user.id), 30000);
    };
    void connect();
    return () => { mounted = false; if (channel) void supabase.removeChannel(channel); if (refreshTimer) clearInterval(refreshTimer); };
  }, []);
  useEffect(() => {
    let mounted = true;
    let customerId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const loadActiveSession = async () => {
      if (!customerId) return;
      const { data: wallet } = await supabase.from('playtime_wallets').select('balance_seconds').eq('customer_id', customerId).maybeSingle();
      if (mounted) setSavedTimeSeconds(Number(wallet?.balance_seconds ?? 0));
      const { data: session, error: sessionQueryError } = await supabase.from('sessions')
        .select('id,ends_at,station_id,stations(name)')
        .eq('customer_id', customerId)
        .eq('status', 'ACTIVE')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mounted) return;
      if (sessionQueryError) {
        setSessionError(sessionQueryError.message);
        setActiveSession(null);
        setReservedPlaytime(null);
        return;
      }
      if (session) {
        setSessionError('');
        setActiveSession(session as ActiveSessionInfo);
        setReservedPlaytime(null);
        return;
      }
      setActiveSession(null);
      const { data: reservation, error: reservationQueryError } = await supabase.from('reservations')
        .select('id,start_at,ends_at,station_id,activation_pin,total_amount,stations(name)')
        .eq('customer_id', customerId)
        .eq('status', 'CONFIRMED')
        .gt('ends_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (mounted) {
        setSessionError(reservationQueryError?.message ?? '');
        setReservedPlaytime(reservation as ReservedPlaytimeInfo | null);
      }
    };
    let refresh: ReturnType<typeof setInterval>;
    const initialize = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      customerId = user?.id ?? null;
      if (!customerId) { setActiveSession(null); setReservedPlaytime(null); return; }
      await loadActiveSession();
      if (!mounted) return;
      const channelId = `customer-active-session-${customerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      channel = supabase.channel(channelId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `customer_id=eq.${customerId}` }, () => void loadActiveSession())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: `customer_id=eq.${customerId}` }, () => void loadActiveSession())
        .subscribe();
      // Polling remains as a fallback if Realtime is unavailable or disconnected.
      refresh = setInterval(() => void loadActiveSession(), 15000);
    };
    void initialize();
    return () => { mounted = false; if (refresh) clearInterval(refresh); if (channel) void supabase.removeChannel(channel); };
  }, []);
  const available = stationList.filter(station => station.status === 'AVAILABLE').length;
  const featured = stationList.filter(station => station.status === 'AVAILABLE').slice(0, 3);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <View>
            <Text style={styles.eyebrow}>YOUR NEXT GAME STARTS HERE</Text>
            <Text style={styles.greeting}>Hey, Gamer <Text style={styles.wave}>✦</Text></Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={unreadNotifications ? `${unreadNotifications} unread notifications` : 'Notifications'} style={styles.bell} onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={21} color={COLORS.white} />
            {unreadNotifications > 0 && <View style={styles.dot} />}
          </Pressable>
        </View>

        <Pressable style={styles.hero} onPress={() => router.push('/stations')}>
          <View style={styles.heroGlow} />
          <View style={styles.heroContent}>
            <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>READY WHEN YOU ARE</Text></View>
            <Text style={styles.heroTitle}>Find your{ '\n' }next-level setup.</Text>
            <Text style={styles.heroSub}>{availabilityError || `${available} stations available right now`}</Text>
            <View style={styles.heroButton}><Text style={styles.heroButtonText}>Explore stations</Text><Ionicons name="arrow-forward" size={16} color="#160B22" /></View>
          </View>
          <View style={styles.heroIcon}><Ionicons name="game-controller" size={74} color="#E2C1FF" /></View>
          <Text style={styles.heroDecor}>GG</Text>
        </Pressable>

        <View style={styles.walletRow}>
          <Pressable style={styles.walletCard} onPress={() => router.push('/history')}>
            <View style={styles.walletIcon}><Ionicons name="wallet-outline" size={19} color={COLORS.cyan} /></View>
            <View style={styles.walletInfo}><Text style={styles.miniLabel}>YOUR ACTIVITY</Text><Text style={styles.walletValue}>Bookings & orders</Text></View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
          </Pressable>
          <Pressable style={styles.pointsCard} onPress={() => router.push('/stations')}><Text style={styles.miniLabel}>PLAYTIME</Text><Text style={styles.pointsValue}>From ₱50<Text style={styles.xp}> / hour</Text></Text><Text style={styles.pointsHint}>Choose your next setup</Text></Pressable>
        </View>

        {activeSession ? <Pressable style={styles.activeSession} accessibilityRole="button" accessibilityLabel={`View all sessions, PCs, PINs, and time balances`} onPress={() => setShowAllSessionsModal(true)}>
          <View style={styles.activeSessionIcon}><Ionicons name="game-controller" size={20} color="#73E2C0" /></View>
          <View style={styles.activeSessionCopy}><Text style={styles.activeSessionLabel}>SESSION IN PROGRESS</Text><Text style={styles.activeSessionStation}>{activeSession.stations?.name ?? activeSession.station_id}</Text><Text style={styles.activeSessionHint}>Tap to see your timer and manage playtime</Text></View>
          <HomeSessionCountdown endsAt={activeSession.ends_at} />
          <Ionicons name="chevron-forward" size={16} color="#73E2C0" />
        </Pressable> : reservedPlaytime ? <Pressable style={[styles.activeSession, styles.noActiveSession]} accessibilityRole="button" accessibilityLabel={`View all reservations, PCs, PINs, and time balances`} onPress={() => setShowAllSessionsModal(true)}>
          <View style={[styles.activeSessionIcon, styles.noActiveSessionIcon]}><Ionicons name="hourglass-outline" size={20} color="#D7B0FF" /></View>
          <View style={styles.activeSessionCopy}><Text style={[styles.activeSessionLabel, styles.noActiveSessionLabel]}>RESERVED PLAYTIME</Text><Text style={styles.activeSessionStation}>{reservedPlaytime.stations?.name ?? reservedPlaytime.station_id}</Text><Text style={styles.activeSessionHint}>Paid time · Show your PIN to staff to start</Text></View>
          <ReservedPlaytimeBalance />
          <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
        </Pressable> : sessionError ? <View style={[styles.activeSession, styles.noActiveSession]}>
          <View style={[styles.activeSessionIcon, styles.noActiveSessionIcon]}><Ionicons name="cloud-offline-outline" size={20} color="#FFC56E" /></View>
          <View style={styles.activeSessionCopy}><Text style={[styles.activeSessionLabel, styles.noActiveSessionLabel]}>SESSION TIMER</Text><Text style={styles.activeSessionStation}>Session could not sync</Text><Text style={styles.activeSessionHint}>Check your connection or Supabase permissions.</Text></View>
        </View> : <Pressable style={[styles.activeSession, styles.noActiveSession]} accessibilityRole="button" accessibilityLabel="Open Your Activity" onPress={() => router.push('/history')}>
          <View style={[styles.activeSessionIcon, styles.noActiveSessionIcon]}><Ionicons name="timer-outline" size={20} color={COLORS.muted} /></View>
          <View style={styles.activeSessionCopy}><Text style={[styles.activeSessionLabel, styles.noActiveSessionLabel]}>SESSION TIMER</Text><Text style={styles.activeSessionStation}>No active session</Text><Text style={styles.activeSessionHint}>Reserve a station to start your playtime</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Find a station" style={styles.reserveSessionButton} onPress={event => { event.stopPropagation(); router.push('/stations'); }}><Text style={styles.reserveSessionLink}>Find a station</Text></Pressable>
          <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
        </Pressable>}

        {savedTimeSeconds > 0 && <Pressable style={styles.savedTimeCard} accessibilityRole="button" onPress={() => router.push('/stations')}>
          <View style={styles.savedTimeIcon}><Ionicons name="hourglass-outline" size={19} color="#D7B0FF" /></View>
          <View style={styles.activeSessionCopy}><Text style={styles.savedTimeLabel}>SAVED PLAYTIME</Text><Text style={styles.activeSessionStation}>Available to use</Text><Text style={styles.activeSessionHint}>Choose an available station to use your remaining balance</Text></View>
          <View style={styles.remainingTime}><Text style={styles.remainingLabel}>BALANCE</Text><Text style={styles.reservedTime}>{formatDuration(savedTimeSeconds)}</Text></View>
          <Ionicons name="chevron-forward" size={16} color="#D7B0FF" />
        </Pressable>}

        <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Quick actions</Text><Text style={styles.sectionSub}>Everything you need for game day</Text></View></View>
        <View style={styles.shortcuts}>
          {shortcuts.map(item => <Pressable key={item.label} style={styles.shortcut} onPress={() => router.push(item.path as any)}>
            <View style={[styles.shortcutIcon, { backgroundColor: `${item.tint}18` }]}><Ionicons name={item.icon as any} size={22} color={item.tint} /></View>
            <View style={styles.shortcutCopy}><Text style={styles.shortcutTitle}>{item.label}</Text><Text style={styles.shortcutSub}>{item.sub}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
          </Pressable>)}
        </View>

        <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Available now</Text><Text style={styles.sectionSub}>Pick a station and lock in your seat</Text></View><Pressable onPress={() => router.push('/stations')}><Text style={styles.seeAll}>See all <Ionicons name="arrow-forward" size={12} /></Text></Pressable></View>
        {featured.map(station => <Pressable key={station.id} style={styles.station} onPress={() => router.push({ pathname: '/station-details', params: { id: station.id } })}>
          <View style={styles.stationArt}><Ionicons name={station.station_type === 'PlayStation' || station.station_type === 'Xbox' ? 'game-controller-outline' : 'desktop-outline'} size={28} color={COLORS.cyan} /><View style={styles.stationOnline} /></View>
          <View style={styles.stationCopy}><Text style={styles.stationName}>{station.name}<Text style={styles.stationType}>  ·  {station.station_type === 'VIP' ? 'VIP PC' : station.station_type === 'PC' ? 'GAMING PC' : station.station_type.toUpperCase()}</Text></Text><Text style={styles.stationSpec}>{station.gpu}  ·  {station.monitor}</Text><Text style={styles.stationRate}>₱{station.rate}<Text style={styles.rateUnit}> / hour</Text></Text></View>
          <View style={styles.availableBadge}><View style={styles.badgeDot} /><Text style={styles.badgeText}>Available</Text></View>
        </Pressable>)}

        <Pressable style={styles.waitingBanner} onPress={() => router.push('/waiting-list')}><View style={styles.waitIcon}><Ionicons name="hourglass-outline" size={20} color="#FFC56E" /></View><View style={styles.waitCopy}><Text style={styles.waitTitle}>Everything is busy?</Text><Text style={styles.waitSub}>Join the waitlist and we’ll save your spot.</Text></View><Ionicons name="chevron-forward" size={18} color={COLORS.muted} /></Pressable>
      </ScrollView>
      <AllSessionPinsModal visible={showAllSessionsModal} onClose={() => setShowAllSessionsModal(false)} />
    </SafeAreaView>
  );
}

function HomeSessionCountdown({ endsAt }: { endsAt: string }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const clock = hours > 0
    ? [hours, minutes, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
    : [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  return <View style={styles.remainingTime}><Text style={styles.remainingLabel}>REMAINING</Text><Text style={[styles.activeSessionTime, seconds <= 300 && styles.activeSessionTimeLow]}>{clock}</Text></View>;
}

function ReservedPlaytimeBalance() {
  return <View style={styles.remainingTime}><Text style={styles.remainingLabel}>TIMER STATUS</Text><Text style={styles.reservedTime}>NOT STARTED</Text></View>;
}

function formatDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30 },
  activeSession: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#10251F', borderWidth: 1, borderColor: '#2A6552', borderRadius: 18, padding: 14, minHeight: 88, marginTop: 15, marginBottom: 18 },
  noActiveSession: { backgroundColor: '#17171F', borderColor: '#343440' },
  savedTimeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#20162A', borderWidth: 1, borderColor: '#59366F', borderRadius: 18, padding: 14, minHeight: 82, marginTop: -4, marginBottom: 18 },
  savedTimeIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#352343' },
  savedTimeLabel: { color: '#D7B0FF', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  activeSessionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D3A31' },
  noActiveSessionIcon: { backgroundColor: '#262630' },
  activeSessionCopy: { flex: 1 },
  activeSessionLabel: { color: '#73E2C0', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  noActiveSessionLabel: { color: '#B8A1CC' },
  activeSessionStation: { color: COLORS.white, fontSize: 12, fontWeight: '800', marginTop: 4 },
  activeSessionHint: { color: '#A4B9B0', fontSize: 8, lineHeight: 12, marginTop: 4 },
  activeSessionTime: { color: '#73E2C0', fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  reservedTime: { color: '#D7B0FF', fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  activeSessionTimeLow: { color: '#FFC56E' },
  remainingTime: { alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 78, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 12, backgroundColor: '#1A382F' },
  remainingLabel: { color: '#A4B9B0', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  reserveSessionButton: { backgroundColor: '#2D2038', borderWidth: 1, borderColor: '#593C70', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 8 },
  reserveSessionLink: { color: '#E0C4F5', fontSize: 8, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28 },
  playtimeModal: { backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, padding: 17, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalHeadingCopy: { flex: 1 },
  modalKicker: { color: '#73E2C0', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  modalTitle: { color: COLORS.white, fontSize: 19, fontWeight: '900', marginTop: 4 },
  modalClose: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.surface2, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: COLORS.white, fontSize: 22, lineHeight: 24 },
  modalBalance: { alignItems: 'center', gap: 4, backgroundColor: '#123128', borderWidth: 1, borderColor: '#28644F', borderRadius: 14, padding: 14, marginTop: 14 },
  modalBalanceLabel: { color: '#A4B9B0', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  modalDetails: { backgroundColor: '#13131B', borderRadius: 13, paddingHorizontal: 12, marginTop: 12 },
  modalDetailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalDetailLabel: { color: COLORS.muted, fontSize: 9 },
  modalDetailValue: { color: COLORS.white, fontSize: 9, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  modalPinBox: { alignItems: 'center', backgroundColor: '#1C1824', borderRadius: 13, padding: 13, marginTop: 12 },
  modalPinLabel: { color: '#C9A4E6', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  modalPin: { color: '#74E4D1', fontSize: 26, fontWeight: '900', letterSpacing: 6, marginTop: 5 },
  modalPinHint: { color: COLORS.muted, fontSize: 8, lineHeight: 13, textAlign: 'center', marginTop: 8 },
  modalAction: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 11, minHeight: 45, marginTop: 13 },
  modalActionText: { color: COLORS.white, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  eyebrow: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  greeting: { color: COLORS.white, fontSize: 25, fontWeight: '800', marginTop: 5, letterSpacing: -0.6 },
  wave: { color: '#C58AFF', fontSize: 20 },
  bell: { width: 44, height: 44, borderRadius: 15, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  dot: { position: 'absolute', right: 10, top: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF6584', borderWidth: 1, borderColor: COLORS.surface },
  hero: { minHeight: 198, borderRadius: 22, padding: 20, backgroundColor: '#28133C', overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: '#51286C' },
  heroGlow: { position: 'absolute', right: -24, top: -70, width: 210, height: 210, borderRadius: 120, backgroundColor: '#67279B', opacity: 0.38 },
  heroContent: { zIndex: 1, alignItems: 'flex-start' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#FFFFFF12', borderRadius: 20 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#59E6AA' },
  liveText: { color: '#DCC7EC', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  heroTitle: { color: COLORS.white, fontSize: 25, lineHeight: 30, fontWeight: '800', marginTop: 12, letterSpacing: -0.5 },
  heroSub: { color: '#D1BEDD', fontSize: 11, marginTop: 7 },
  preview: { color: '#FFD38A', fontSize: 7, fontWeight: '800', maxWidth: 190, marginTop: 6 },
  heroButton: { marginTop: 14, backgroundColor: '#D4A4FF', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroButtonText: { color: '#21102F', fontSize: 10, fontWeight: '800' },
  heroIcon: { position: 'absolute', right: 22, top: 64, transform: [{ rotate: '-12deg' }], opacity: 0.88 },
  heroDecor: { position: 'absolute', right: 10, top: 4, color: '#FFFFFF0A', fontWeight: '900', fontSize: 60 },
  walletRow: { flexDirection: 'row', gap: 10, marginTop: 13 },
  walletCard: { flex: 1.1, minHeight: 76, backgroundColor: COLORS.surface, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  walletIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#00CFFF16', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  walletInfo: { flex: 1 },
  miniLabel: { color: COLORS.muted, fontSize: 8, letterSpacing: 0.6, fontWeight: '700' },
  walletValue: { color: COLORS.white, fontWeight: '800', fontSize: 17, marginTop: 3 },
  pointsCard: { flex: 0.9, minHeight: 76, backgroundColor: COLORS.surface, borderRadius: 16, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  pointsValue: { color: '#D9B4FF', fontSize: 17, fontWeight: '800', marginTop: 3 },
  xp: { color: '#B99ACB', fontSize: 10 },
  pointsHint: { color: COLORS.muted, fontSize: 8, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 25, marginBottom: 12 },
  sectionTitle: { color: COLORS.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  sectionSub: { color: COLORS.muted, fontSize: 10, marginTop: 4 },
  shortcuts: { gap: 8 },
  shortcut: { backgroundColor: COLORS.surface, borderRadius: 15, minHeight: 62, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#282833' },
  shortcutIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  shortcutCopy: { flex: 1 },
  shortcutTitle: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  shortcutSub: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  seeAll: { color: '#C58AFF', fontWeight: '700', fontSize: 10, paddingBottom: 2 },
  station: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: COLORS.surface, borderRadius: 15, marginBottom: 8, borderWidth: 1, borderColor: '#282833' },
  stationArt: { width: 56, height: 54, borderRadius: 12, backgroundColor: '#162431', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  stationOnline: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: '#59E6AA', right: 7, top: 7 },
  stationCopy: { flex: 1, paddingHorizontal: 10 },
  stationName: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  stationType: { color: COLORS.muted, fontSize: 8, fontWeight: '600' },
  stationSpec: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
  stationRate: { color: '#D7A8FF', fontSize: 11, fontWeight: '800', marginTop: 5 },
  rateUnit: { color: COLORS.muted, fontSize: 9, fontWeight: '400' },
  availableBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 6, backgroundColor: '#133528', borderRadius: 8 },
  badgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#59E6AA' },
  badgeText: { color: '#8CE8BE', fontSize: 8, fontWeight: '700' },
  waitingBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#24202B', borderRadius: 15, borderWidth: 1, borderColor: '#39303F', padding: 12, marginTop: 12 },
  waitIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFC56E18', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  waitCopy: { flex: 1 },
  waitTitle: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  waitSub: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
});
