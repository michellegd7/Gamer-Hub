import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';

type SessionReservation = {
  id: string;
  activation_pin: string | null;
  status: string;
  start_at: string;
  total_amount: number | string;
  created_at: string;
  ends_at: string;
  station_id: string;
  stations?: { name?: string } | null;
  sessions?: { id: string; status: string; ends_at: string; station_id: string; stations?: { name?: string } | null } | { id: string; status: string; ends_at: string; station_id: string; stations?: { name?: string } | null }[] | null;
};

type Props = { visible: boolean; onClose: () => void };

export default function AllSessionPinsModal({ visible, onClose }: Props) {
  const [rows, setRows] = useState<SessionReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError('');
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (mounted) { setError(userError.message); setRows([]); setLoading(false); }
        return;
      }
      if (!user) {
        if (mounted) { setRows([]); setLoading(false); }
        return;
      }
      const { data, error: queryError } = await supabase
        .from('reservations')
        .select('id,activation_pin,status,start_at,ends_at,total_amount,station_id,created_at,stations(name),sessions(id,status,ends_at,station_id,stations(name))')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!mounted) return;
      if (queryError) { setError(queryError.message); setRows([]); }
      else setRows((data ?? []) as SessionReservation[]);
      setLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>ALL SESSIONS & PINS</Text>
              <Text style={styles.subtitle}>Your most recently reserved station appears first, with its PIN and time balance easy to find.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close session PINs" style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          {loading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : error ? <Text style={styles.error}>{error}</Text> : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {rows.length ? [...rows].sort((a, b) => {
                const rank = (status: string) => status === 'ACTIVE' ? 0 : status === 'CONFIRMED' ? 1 : status === 'PAUSED' ? 2 : 3;
                return rank(a.status) - rank(b.status) || new Date(b.created_at ?? b.start_at).getTime() - new Date(a.created_at ?? a.start_at).getTime();
              }).map(row => {
                const ready = row.status === 'CONFIRMED';
                const linkedSession = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions;
                const active = row.status === 'ACTIVE' || linkedSession?.status === 'ACTIVE';
                return (
                  <View key={row.id} style={styles.sessionCard}>
                    <View style={styles.row}>
                      <Text style={styles.station}>{row.stations?.name ?? row.station_id}</Text>
                      <Text style={styles.status}>{row.status.replace('_', ' ')}</Text>
                    </View>
                    <Text style={styles.date}>{new Date(row.start_at).toLocaleString()} · ₱{Number(row.total_amount).toFixed(2)}</Text>
                    <SessionTimeBalance status={active ? 'ACTIVE' : row.status} endsAt={active ? linkedSession?.ends_at ?? row.ends_at : row.ends_at} />
                    <View style={styles.pinBox}>
                      <Text style={styles.pinLabel}>SESSION PIN</Text>
                      <Text selectable style={styles.pin}>{row.activation_pin || '—'}</Text>
                    </View>
                    <Text style={[styles.eligibility, ready && styles.ready, active && styles.active]}>
                      {ready ? 'Ready — show this PIN to staff to activate.' : active ? 'Session is active — the PIN is no longer needed.' : row.status === 'PAUSED' ? 'Ended early · unused time is saved to your account balance.' : `Not ready for activation · ${row.status.replace('_', ' ').toLowerCase()}`}
                    </Text>
                    <Pressable style={styles.openButton} onPress={() => {
                      onClose();
                      if (active && linkedSession) {
                        router.push({ pathname: '/active-session', params: { sessionId: linkedSession.id, endsAt: linkedSession.ends_at, stationId: linkedSession.station_id, stationName: linkedSession.stations?.name ?? linkedSession.station_id } });
                      } else {
                        router.push({ pathname: '/qr-activation', params: { reservationId: row.id } });
                      }
                    }}>
                      <Text style={styles.openButtonText}>{active ? 'OPEN LIVE SESSION' : 'OPEN RESERVATION'}</Text>
                    </Pressable>
                  </View>
                );
              }) : <Text style={styles.empty}>No session reservations yet.</Text>}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 28 },
  modal: { maxHeight: '86%', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerCopy: { flex: 1 },
  title: { color: COLORS.white, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 5 },
  closeButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.surface2, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: COLORS.white, fontSize: 23, lineHeight: 25 },
  loader: { marginVertical: 28 },
  error: { color: '#FFC56E', fontSize: 10, lineHeight: 16, paddingVertical: 20 },
  list: { flexGrow: 0, marginTop: 10 },
  listContent: { paddingBottom: 5 },
  sessionCard: { backgroundColor: '#13131B', borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 9 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  station: { color: '#D7B0FF', fontWeight: '800', fontSize: 11, flexShrink: 1 },
  status: { color: '#65DDBA', fontSize: 9, fontWeight: '700' },
  date: { color: COLORS.muted, fontSize: 9, marginTop: 5 },
  pinBox: { backgroundColor: '#1C1824', borderRadius: 9, padding: 10, marginTop: 10, alignItems: 'center' },
  pinLabel: { color: '#C9A4E6', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  pin: { color: '#74E4D1', fontSize: 24, fontWeight: '900', letterSpacing: 6, marginTop: 5 },
  eligibility: { color: '#FFC56E', fontSize: 8, lineHeight: 12, textAlign: 'center', marginTop: 8 },
  ready: { color: '#73E2C0' },
  active: { color: '#D7B0FF' },
  balanceBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#11251F', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9, marginTop: 9 },
  balanceLabel: { color: '#A4B9B0', fontSize: 8, fontWeight: '800' },
  balanceValue: { color: '#73E2C0', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  balancePending: { color: '#D7B0FF', fontSize: 10, fontWeight: '800' },
  openButton: { alignItems: 'center', backgroundColor: '#2D2038', borderWidth: 1, borderColor: '#593C70', borderRadius: 9, paddingVertical: 9, marginTop: 10 },
  openButtonText: { color: '#E0C4F5', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  empty: { color: COLORS.muted, fontSize: 10, textAlign: 'center', paddingVertical: 26 },
});

function SessionTimeBalance({ status, endsAt }: { status: string; endsAt: string }) {
  const active = status === 'ACTIVE';
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));
    update();
    if (!active) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [active, endsAt]);

  if (!active) {
    const balanceMessage = status === 'CONFIRMED' ? 'Starts on activation' : status === 'PENDING_PAYMENT' ? 'Waiting for payment' : status.replace('_', ' ').toLowerCase();
    return <View style={styles.balanceBox}><Text style={styles.balanceLabel}>TIME BALANCE</Text><Text style={styles.balancePending}>{balanceMessage}</Text></View>;
  }

  const formatted = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');

  return <View style={styles.balanceBox}><Text style={styles.balanceLabel}>TIME REMAINING</Text><Text style={styles.balanceValue}>{formatted}</Text></View>;
}
