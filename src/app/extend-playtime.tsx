import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import PaypalCheckoutModal from '../components/PaypalCheckoutModal';
import OptionRow from '../components/OptionRow';
import { supabase } from '../lib/supabase';
import { fetchPlaytimePackages, HubPackage } from '../data/gamingHub';

export default function ExtendPlaytime() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [packages, setPackages] = useState<HubPackage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packageError, setPackageError] = useState('');
  const selected = packages.find(item => item.id === selectedId) ?? packages[0];
  const [method, setMethod] = useState('Counter');
  const [saving, setSaving] = useState(false);
  const [pendingPaypalPaymentId, setPendingPaypalPaymentId] = useState('');
  const [paypalVisible, setPaypalVisible] = useState(false);
  const [paypalPaymentId, setPaypalPaymentId] = useState('');

  useEffect(() => {
    let mounted = true;
    fetchPlaytimePackages().then(data => {
      if (!mounted) return;
      setPackages(data);
      setSelectedId(current => current || data.find(item => item.duration_minutes === 60)?.id || data[0]?.id || '');
    }).catch(error => {
      if (mounted) setPackageError(error instanceof Error ? error.message : 'Could not load playtime packages.');
    }).finally(() => { if (mounted) setPackagesLoading(false); });
    return () => { mounted = false; };
  }, []);

  const requestExtension = async () => {
    if (!sessionId || saving || !selected) {
      Alert.alert('Session not found', 'Return to your active session and try again.');
      return;
    }
    setSaving(true);
    try {
      if (method === 'PayPal' && pendingPaypalPaymentId) {
        setPaypalPaymentId(pendingPaypalPaymentId);
        setPaypalVisible(true);
        return;
      }
      const { data, error } = await supabase.rpc('create_gamerhub_extension_payment', {
        p_session_id: sessionId,
        p_package_id: selected.id,
        p_method: method,
      });
      if (error) throw error;
      if (method === 'PayPal' && data?.id) {
        setPendingPaypalPaymentId(data.id);
        setPaypalPaymentId(data.id);
        setPaypalVisible(true);
        return;
      }
      Alert.alert('Extension requested', 'Your extension payment is pending. Staff will verify receipt and add the time to your session.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) {
      Alert.alert('Could not request extension', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="EXTEND PLAYTIME" />
        <View style={styles.timeBox}><Text style={styles.muted}>Keep your current session running</Text><Text style={styles.time}>Choose extra time</Text></View>
        {packagesLoading ? <ActivityIndicator color={COLORS.cyan} style={{ marginVertical: 20 }} /> : packageError ? <Text style={styles.note}>Packages unavailable: {packageError}</Text> : !packages.length ? <Text style={styles.note}>No active packages are available. Please ask staff for help.</Text> : packages.map(item => <OptionRow key={item.id} label={item.name} price={item.price} selected={selected?.id === item.id} onPress={() => setSelectedId(item.id)} />)}
        <Text style={styles.label}>PAYMENT METHOD</Text>
        <View style={styles.methods}>{['Counter', 'PayPal'].map(item => <Pressable key={item} onPress={() => setMethod(item)} style={[styles.method, method === item && styles.methodSelected]}><Text style={[styles.methodText, method === item && styles.methodTextSelected]}>{item === 'Counter' ? 'At counter' : item}</Text></Pressable>)}</View>
        <View style={styles.total}><Text style={styles.totalText}>Pending total</Text><Text style={styles.totalValue}>₱{Number(selected?.price ?? 0).toFixed(2)}</Text></View>
        <Text style={styles.note}>{method === 'PayPal' ? 'PayPal Sandbox checkout confirms payment on the server and adds the selected time to your active session.' : 'This creates a payment request only. Staff verify your counter payment and add the time to your session.'}</Text>
        <AppButton title={saving ? 'PROCESSING…' : !selected ? 'PACKAGES UNAVAILABLE' : pendingPaypalPaymentId && method === 'PayPal' ? 'RETRY PAYPAL PAYMENT' : method === 'PayPal' ? 'PAY WITH PAYPAL' : 'REQUEST TIME EXTENSION'} onPress={() => void requestExtension()} style={styles.button} />
      </View>
      <PaypalCheckoutModal
        visible={paypalVisible}
        paymentId={paypalPaymentId}
        onPaid={() => {
          setPaypalVisible(false);
          setPendingPaypalPaymentId('');
          setPaypalPaymentId('');
          Alert.alert('Payment complete', 'PayPal confirmed your payment and the extra playtime has been added.', [{ text: 'OK', onPress: () => router.back() }]);
        }}
        onCancel={() => {
          setPaypalVisible(false);
          Alert.alert('Payment not completed', 'PayPal checkout was closed. You can retry the pending payment from this screen.');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20, paddingBottom: 22 }, timeBox: { backgroundColor: COLORS.surface, borderRadius: 13, padding: 15, marginVertical: 13 }, muted: { color: COLORS.muted, fontSize: 10 }, time: { color: COLORS.cyan, fontSize: 17, fontWeight: '800', marginTop: 7 }, label: { color: COLORS.muted, fontSize: 9, fontWeight: '700', marginTop: 15, marginBottom: 8 }, methods: { flexDirection: 'row', gap: 7 }, method: { flex: 1, alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, methodSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.purpleSoft }, methodText: { color: COLORS.muted, fontSize: 9, fontWeight: '700' }, methodTextSelected: { color: COLORS.white }, total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', marginBottom: 11 }, totalText: { color: COLORS.white, fontSize: 13, fontWeight: '700' }, totalValue: { color: '#D6B4F4', fontSize: 15, fontWeight: '800' }, note: { color: COLORS.muted, fontSize: 8, lineHeight: 13, marginBottom: 13 }, button: { marginBottom: 5 } });
