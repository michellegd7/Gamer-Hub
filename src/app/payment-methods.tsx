import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { supabase } from '../lib/supabase';

const methods = [
  { id: 'Counter', title: 'Pay at the counter', detail: 'Pay staff in person before your session', icon: 'storefront-outline' },
  { id: 'PayPal', title: 'PayPal Sandbox', detail: 'Secure test checkout; no live money is charged', icon: 'card-outline' },
] as const;

export default function PaymentMethods() {
  const [method, setMethod] = useState<string>('Counter');
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaError, setSchemaError] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) setLoading(false); return; }
      const { data, error } = await supabase.from('profiles').select('preferred_payment_method').eq('id', user.id).maybeSingle();
      if (!mounted) return;
      setUserId(user.id);
      if (error) setSchemaError(error.message);
      else if (data?.preferred_payment_method === 'Counter' || data?.preferred_payment_method === 'PayPal') setMethod(data.preferred_payment_method);
      setLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, []);

  const save = async () => {
    if (!userId || saving) { Alert.alert('Sign in required', 'Sign in to save a preferred payment method.'); return; }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ preferred_payment_method: method }).eq('id', userId);
    setSaving(false);
    if (error) { Alert.alert('Could not save preference', `${error.message}\n\nCheck that the GamerHub profile migration has been applied.`); return; }
    Alert.alert('Payment preference saved', `${method === 'Counter' ? 'Counter payment' : method} will be selected by default at checkout.`);
  };

  return <SafeAreaView style={styles.screen}><View style={styles.container}><AppHeader title="PAYMENT METHODS" />
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.cyan} /></View> : <>
      <Text style={styles.intro}>Choose a preferred way to pay for reservations and playtime extensions.</Text>
      {methods.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: method === item.id }} onPress={() => setMethod(item.id)} style={[styles.method, method === item.id && styles.methodSelected]}>
        <View style={styles.icon}><Ionicons name={item.icon as any} size={21} color={method === item.id ? COLORS.cyan : COLORS.muted} /></View>
        <View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View>
        <View style={[styles.radio, method === item.id && styles.radioSelected]} />
      </Pressable>)}
      <View style={styles.notice}><Ionicons name="information-circle-outline" size={18} color="#FFC56E" /><Text style={styles.noticeText}>This saves only your preferred method. Counter payments are verified by staff. PayPal uses the Sandbox test environment.</Text></View>
      {schemaError ? <Text style={styles.migration}>Could not load the saved preference. Apply the profile migration to enable saving.</Text> : null}
      <AppButton title={saving ? 'SAVING…' : 'SAVE PREFERENCE'} onPress={() => void save()} style={styles.save} />
    </>}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: COLORS.background }, container: { flex: 1, paddingHorizontal: 20 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, intro: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginBottom: 18 }, method: { flexDirection: 'row', alignItems: 'center', padding: 13, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: COLORS.surface, marginBottom: 10 }, methodSelected: { borderColor: COLORS.primary, backgroundColor: '#20162A' }, icon: { width: 41, height: 41, borderRadius: 12, backgroundColor: '#161621', alignItems: 'center', justifyContent: 'center', marginRight: 11 }, copy: { flex: 1 }, title: { color: COLORS.white, fontSize: 12, fontWeight: '800' }, detail: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 4 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: COLORS.muted, marginLeft: 9 }, radioSelected: { borderWidth: 5, borderColor: COLORS.primary }, notice: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#2B2418', marginTop: 7 }, noticeText: { color: '#E2D2B5', flex: 1, fontSize: 9, lineHeight: 15 }, migration: { color: '#FFC56E', fontSize: 9, lineHeight: 14, marginTop: 10 }, save: { marginTop: 'auto', marginBottom: 16 } });
