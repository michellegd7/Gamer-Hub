import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import { supabase } from '../lib/supabase';

export default function QRActivation() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const [status, setStatus] = useState('PENDING_PAYMENT');
  const [stationName, setStationName] = useState('Your station');
  const [activationPin, setActivationPin] = useState('');
  const [checking, setChecking] = useState(true);
  const navigated = useRef(false);

  useEffect(() => {
    if (!reservationId) return;
    let mounted = true;
    const checkReservation = async () => {
      const { data, error } = await supabase.from('reservations')
        .select('status, activation_pin, stations(name)')
        .eq('id', reservationId)
        .maybeSingle();
      if (!mounted) return;
      if (!error && data) {
        setStatus(data.status);
        setActivationPin(data.activation_pin ?? '');
        setStationName((data as any).stations?.name ?? 'Your station');
        if (data.status === 'ACTIVE' && !navigated.current) {
          navigated.current = true;
          const { data: session } = await supabase.from('sessions')
            .select('id, ends_at, station_id, stations(name)')
            .eq('reservation_id', reservationId)
            .maybeSingle();
          if (mounted && session) router.replace({ pathname: '/active-session', params: { sessionId: session.id, endsAt: session.ends_at, stationId: session.station_id, stationName: (session as any).stations?.name } });
        }
      }
      setChecking(false);
    };
    void checkReservation();
    const timer = setInterval(() => void checkReservation(), 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, [reservationId]);

  const statusCopy = status === 'PENDING_PAYMENT'
    ? 'Payment request saved. Staff will verify your payment before confirming this reservation.'
    : status === 'CONFIRMED'
      ? 'Payment verified. Show this PIN to staff to activate your session.'
      : status === 'ACTIVE'
        ? 'Your session is starting…'
        : `Reservation status: ${status.toLowerCase().replace('_', ' ')}.`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="SESSION ACTIVATION" />
        <View style={styles.center}>
          <View style={styles.icon}><Ionicons name="game-controller-outline" size={27} color={COLORS.cyan} /></View>
          <Text style={styles.title}>{stationName}</Text>
          <Text style={styles.instruction}>{statusCopy}</Text>
          <View style={styles.pinCard}>
            {status === 'CONFIRMED' || status === 'ACTIVE' ? <>
              <Text style={styles.pinLabel}>YOUR SESSION PIN</Text>
              <Text selectable style={styles.pin}>{activationPin || '------'}</Text>
              <Text style={styles.pinHint}>Share with staff only when your payment is verified. Find it again in Profile → History → Sessions.</Text>
            </> : <>
              <Text style={styles.pinLabel}>SESSION PIN</Text>
              <Text style={styles.pinHint}>Your PIN will be available here after payment is confirmed.</Text>
            </>}
          </View>
          <View style={styles.statusRow}>
            {checking && reservationId ? <ActivityIndicator size="small" color={COLORS.primary} /> : <View style={[styles.dot, status === 'ACTIVE' ? styles.dotActive : undefined]} />}
            <Text style={styles.status}>{!reservationId ? 'Reservation not found' : checking ? 'Checking reservation…' : status.replace('_', ' ')}</Text>
          </View>
          <Text style={styles.poll}>This screen updates when staff verifies payment and activates your station.</Text>
        </View>
        <Pressable style={styles.homeButton} onPress={() => router.replace('/home')}><Ionicons name="home-outline" size={16} color="#D5ABFF" /><Text style={styles.homeText}>BACK TO HOME</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 24 },
  icon: { width: 58, height: 58, borderRadius: 19, backgroundColor: '#142733', alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.white, fontSize: 19, fontWeight: '800', marginTop: 15 },
  instruction: { color: COLORS.muted, textAlign: 'center', fontSize: 11, lineHeight: 18, marginTop: 8, maxWidth: 300 },
  pinCard: { width: '100%', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1, borderColor: '#4C2B64', padding: 20, marginTop: 24 },
  pinLabel: { color: '#C9A4E6', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  pin: { color: '#74E4D1', fontSize: 35, fontWeight: '900', letterSpacing: 8, marginVertical: 12 },
  pinHint: { color: COLORS.muted, fontSize: 9, textAlign: 'center', lineHeight: 14 },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 19 },
  dot: { width: 8, height: 8, borderRadius: 5, backgroundColor: '#FFC56E' },
  dotActive: { backgroundColor: '#59E6AA' },
  status: { color: COLORS.white, fontWeight: '700', fontSize: 10 },
  poll: { color: COLORS.muted, textAlign: 'center', fontSize: 9, lineHeight: 14, marginTop: 14, maxWidth: 270 },
  homeButton: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: '#29183A', padding: 13, borderRadius: 11, marginBottom: 20 },
  homeText: { color: '#D5ABFF', fontSize: 10, fontWeight: '800' },
});
