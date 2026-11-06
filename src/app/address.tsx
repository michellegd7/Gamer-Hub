import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { supabase } from '../lib/supabase';

type AddressForm = { address_line: string; barangay: string; city: string; province: string; postal_code: string; country: string };
const blank: AddressForm = { address_line: '', barangay: '', city: '', province: '', postal_code: '', country: 'Philippines' };

export default function Address() {
  const [form, setForm] = useState(blank);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof AddressForm, value: string) => setForm(current => ({ ...current, [key]: value }));

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) { setError('Sign in to manage your address.'); setLoading(false); } return; }
      const { data, error: queryError } = await supabase.from('profiles').select('address_line,barangay,city,province,postal_code,country').eq('id', user.id).maybeSingle();
      if (!mounted) return;
      setUserId(user.id);
      if (queryError) setError(queryError.message);
      else if (data) setForm({ ...blank, ...data });
      setLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, []);

  const save = async () => {
    if (saving || !userId) return;
    setSaving(true);
    const { error: updateError } = await supabase.from('profiles').update({ ...form, address_line: form.address_line.trim(), barangay: form.barangay.trim(), city: form.city.trim(), province: form.province.trim(), postal_code: form.postal_code.trim(), country: form.country.trim() || 'Philippines' }).eq('id', userId);
    setSaving(false);
    if (updateError) { Alert.alert('Could not save address', updateError.message); return; }
    Alert.alert('Address saved', 'Your address is saved to your GamerHub profile.');
  };

  return <SafeAreaView style={styles.screen}><View style={styles.container}><AppHeader title="MY ADDRESS" />
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.cyan} /></View> : error ? <Text style={styles.error}>{error}</Text> : <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Save your address to your account for contact and account records. Food orders in this version are delivered to your gaming station.</Text>
        <Field label="Street address / building" value={form.address_line} onChangeText={value => set('address_line', value)} />
        <Field label="Barangay" value={form.barangay} onChangeText={value => set('barangay', value)} />
        <View style={styles.row}><Field label="City / municipality" value={form.city} onChangeText={value => set('city', value)} /><Field label="Province" value={form.province} onChangeText={value => set('province', value)} /></View>
        <View style={styles.row}><Field label="Postal code" value={form.postal_code} onChangeText={value => set('postal_code', value)} keyboardType="number-pad" /><Field label="Country" value={form.country} onChangeText={value => set('country', value)} /></View>
      </ScrollView>
      <AppButton title={saving ? 'SAVING…' : 'SAVE ADDRESS'} onPress={() => void save()} style={styles.save} />
    </>}
  </View></SafeAreaView>;
}

function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'number-pad' }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType ?? 'default'} style={styles.input} placeholder={label} placeholderTextColor={COLORS.muted} selectionColor={COLORS.cyan} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: COLORS.background }, container: { flex: 1, paddingHorizontal: 20 }, scroll: { flex: 1 }, body: { paddingBottom: 20 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, intro: { color: COLORS.muted, fontSize: 10, lineHeight: 16, marginBottom: 18 }, field: { flex: 1, marginBottom: 14 }, label: { color: '#CBB2DF', fontSize: 10, fontWeight: '700', marginBottom: 7 }, input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, minHeight: 47, paddingHorizontal: 13, color: COLORS.white, fontSize: 12 }, row: { flexDirection: 'row', gap: 10 }, save: { marginBottom: 16 }, error: { color: '#FFC56E', fontSize: 11, textAlign: 'center', marginTop: 35 } });
