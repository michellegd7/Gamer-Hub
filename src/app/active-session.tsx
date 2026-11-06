import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import AllSessionPinsModal from '../components/AllSessionPinsModal';
import { supabase } from '../lib/supabase';

export default function ActiveSession() {
  const { sessionId, endsAt, stationId, stationName } = useLocalSearchParams<{ sessionId: string; endsAt: string; stationId: string; stationName: string }>();
  const [endTime, setEndTime] = useState(() => typeof endsAt === 'string' ? new Date(endsAt).getTime() : 0);
  const [sessionStatus, setSessionStatus] = useState('ACTIVE');
  const [ending, setEnding] = useState(false);
  const [showAllSessionPins, setShowAllSessionPins] = useState(false);
  const [currentStation, setCurrentStation] = useState(stationName || stationId || 'Gaming station');
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
  const [reminderEnabled, setReminderEnabled] = useState(true);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem('gamerhub.session-reminder').then(value => {
      if (mounted && value !== null) setReminderEnabled(value !== 'false');
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    const refreshSession = async () => {
      const { data } = await supabase.from('sessions').select('status, ends_at, station_id, stations(name)').eq('id', sessionId).maybeSingle();
      if (!mounted || !data) return;
      setSessionStatus(data.status);
      setEndTime(new Date(data.ends_at).getTime());
      setCurrentStation((data as any).stations?.name ?? data.station_id);
    };
    void refreshSession();
    const timer = setInterval(() => void refreshSession(), 15000);
    const channelId = `customer-session-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, () => void refreshSession())
      .subscribe();
    return () => { mounted = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, [sessionId]);

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const hours = Math.floor(seconds / 3600);
  const formatTime = (hours > 0
    ? [hours, Math.floor((seconds % 3600) / 60), seconds % 60]
    : [Math.floor(seconds / 60), seconds % 60])
    .map(value => String(value).padStart(2, '0')).join(' : ');
  const endLabel = endTime ? new Date(endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not available';

  const endSession = async () => {
    if (!sessionId || ending || sessionStatus !== 'ACTIVE') return;
    setEnding(true);
    try {
      const { data: remainingSeconds, error } = await supabase.rpc('end_gamerhub_session', { p_session_id: sessionId });
      if (error) throw error;
      const savedSeconds = Number(remainingSeconds ?? 0);
      setSessionStatus(savedSeconds > 0 ? 'PAUSED' : 'COMPLETED');
      setEndTime(0);
      setSeconds(0);
      Alert.alert(savedSeconds > 0 ? 'Time saved to your account' : 'Session completed', savedSeconds > 0
        ? `${formatSeconds(savedSeconds)} of unused playtime was saved. The station is now available. Use your saved time when reserving another station.`
        : 'Your time ran out. The session is complete and the station is available.', [
        { text: 'Back to home', onPress: () => router.replace('/home') },
      ]);
    } catch (error) {
      Alert.alert('Could not end session', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setEnding(false);
    }
  };

  const formatSeconds = (value: number) => [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map(part => String(part).padStart(2, '0')).join(':');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="YOUR SESSION" />
        <Text style={[styles.active, sessionStatus !== 'ACTIVE' && styles.ended]}>{sessionStatus === 'ACTIVE' ? '● SESSION ACTIVE' : sessionStatus === 'PAUSED' ? 'TIME SAVED' : 'SESSION COMPLETED'}</Text>
        <Text style={styles.pc}>{currentStation}</Text>
        <View style={styles.timer}>
          <Text style={styles.label}>Time Remaining</Text>
          <Text style={styles.time}>{formatTime}</Text>
          <Text style={styles.ends}>{sessionStatus === 'PAUSED' ? 'Unused time saved to your account balance.' : sessionStatus !== 'ACTIVE' ? 'Your playtime has been used.' : seconds ? `ENDS AT ${endLabel}` : 'TIME IS UP · PLEASE ASK STAFF'}</Text>
          {sessionStatus === 'ACTIVE' && reminderEnabled && seconds > 0 && seconds <= 300 && <Text style={styles.reminder}>5 minutes or less remain. Ask staff to extend your time.</Text>}
        </View>
        <View style={styles.info}>
          <View style={styles.row}><Text style={styles.muted}>Session ID</Text><Text style={styles.white}>{sessionId ? sessionId.slice(0, 8).toUpperCase() : '—'}</Text></View>
          <View style={styles.row}><Text style={styles.muted}>Station</Text><Text style={styles.white}>{currentStation}</Text></View>
          <View style={styles.row}><Text style={styles.muted}>Ends</Text><Text style={styles.white}>{endLabel}</Text></View>
        </View>
        <Pressable style={styles.allPinsButton} onPress={() => setShowAllSessionPins(true)}><Text style={styles.allPinsText}>VIEW ALL SESSIONS & PINS</Text><Text style={styles.allPinsArrow}>›</Text></Pressable>
        <View style={styles.buttons}>
          {sessionStatus === 'ACTIVE' && <>
            <AppButton title="EXTEND PLAYTIME" onPress={() => router.push({ pathname: '/extend-playtime', params: { sessionId, endsAt } })} />
            <AppButton title="REQUEST COMPUTER TRANSFER" variant="outline" onPress={() => router.push({ pathname: '/transfer-request', params: { sessionId, stationId } })} />
            <Text style={styles.staffNote}>Ending early saves unused time to your GamerHub balance and releases this station.</Text>
            <AppButton title={ending ? 'SAVING TIME…' : 'END THIS SESSION'} variant="danger" onPress={() => Alert.alert('End this session?', 'Your timer will stop now. Any unused seconds will be saved to your account, and this station will be released.', [
              { text: 'Keep playing', style: 'cancel' },
              { text: 'End session', style: 'destructive', onPress: () => void endSession() },
            ])} />
          </>}
          <AppButton title="BACK TO HOME" variant="outline" onPress={() => router.replace('/home')} />
        </View>
      </View>
      <AllSessionPinsModal visible={showAllSessionPins} onClose={() => setShowAllSessionPins(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20 }, active: { color: COLORS.green, textAlign: 'center', fontSize: 11, fontWeight: '800' }, ended: { color: COLORS.muted }, pc: { color: COLORS.cyan, textAlign: 'center', fontSize: 18, fontWeight: '700', marginTop: 8 }, timer: { marginTop: 28, borderWidth: 1, borderColor: COLORS.cyan, borderRadius: 16, padding: 19, alignItems: 'center', backgroundColor: '#10202A' }, label: { color: COLORS.white, fontSize: 11 }, time: { color: COLORS.cyan, fontSize: 27, fontWeight: '800', marginVertical: 10, fontVariant: ['tabular-nums'] }, ends: { color: COLORS.muted, fontSize: 9 }, reminder: { color: '#FFC56E', fontSize: 9, fontWeight: '800', marginTop: 11, textAlign: 'center' }, info: { backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 14, marginTop: 18 }, row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border }, muted: { color: COLORS.muted, fontSize: 10 }, white: { color: COLORS.white, fontSize: 10 }, allPinsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#21152D', borderColor: '#59366F', borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, marginTop: 10 }, allPinsText: { color: '#D7B0FF', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 }, allPinsArrow: { color: '#D7B0FF', fontSize: 19, lineHeight: 20 }, buttons: { marginTop: 'auto', marginBottom: 23, gap: 10 }, staffNote: { color: COLORS.muted, fontSize: 9, textAlign: 'center', marginVertical: 2 } });
