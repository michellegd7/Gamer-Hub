import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { supabase } from '../lib/supabase';

type ProfileForm = { first_name: string; middle_name: string; last_name: string; username: string; age: string; gender: string; email: string };
const emptyForm: ProfileForm = { first_name: '', middle_name: '', last_name: '', username: '', age: '', gender: '', email: '' };

export default function PersonalInformation() {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof ProfileForm, value: string) => setForm(current => ({ ...current, [key]: value }));

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) { setError('Sign in to edit your profile.'); setLoading(false); } return; }
      const { data, error: queryError } = await supabase.from('profiles').select('first_name,middle_name,last_name,username,age,gender,email').eq('id', user.id).maybeSingle();
      if (!mounted) return;
      if (queryError) setError(queryError.message);
      else if (data) setForm({ first_name: data.first_name ?? '', middle_name: data.middle_name ?? '', last_name: data.last_name ?? '', username: data.username ?? '', age: data.age == null ? '' : String(data.age), gender: data.gender ?? '', email: data.email || user.email || '' });
      setLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, []);

  const save = async () => {
    if (saving) return;
    const username = form.username.trim();
    const age = form.age.trim() ? Number(form.age) : null;
    if (username.length < 3) { Alert.alert('Check username', 'Your username must be at least 3 characters.'); return; }
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 120)) { Alert.alert('Check age', 'Enter a whole number from 13 to 120.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('Sign in required', 'Sign in again to save your profile.'); return; }
    setSaving(true);
    const { error: updateError } = await supabase.from('profiles').update({ first_name: form.first_name.trim(), middle_name: form.middle_name.trim(), last_name: form.last_name.trim(), username, age, gender: form.gender.trim() || null }).eq('id', user.id);
    setSaving(false);
    if (updateError) { Alert.alert('Could not save profile', updateError.message); return; }
    Alert.alert('Profile saved', 'Your personal information has been updated.');
  };

  return <SafeAreaView style={styles.screen}><View style={styles.container}><AppHeader title="PERSONAL INFORMATION" />
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.cyan} /></View> : error ? <Text style={styles.error}>{error}</Text> : <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Keep your GamerHub account details up to date.</Text>
        <Field label="First name" value={form.first_name} onChangeText={value => set('first_name', value)} />
        <Field label="Middle name (optional)" value={form.middle_name} onChangeText={value => set('middle_name', value)} />
        <Field label="Last name" value={form.last_name} onChangeText={value => set('last_name', value)} />
        <Field label="Username" value={form.username} onChangeText={value => set('username', value)} autoCapitalize="none" />
        <View style={styles.row}><Field label="Age" value={form.age} onChangeText={value => set('age', value.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" /><Field label="Gender (optional)" value={form.gender} onChangeText={value => set('gender', value)} /></View>
        <Text style={styles.label}>Gmail account</Text><View style={styles.readOnly}><Text style={styles.readOnlyText}>{form.email || '—'}</Text><Text style={styles.hint}>Email changes are managed through account verification.</Text></View>
      </ScrollView>
      <AppButton title={saving ? 'SAVING…' : 'SAVE CHANGES'} onPress={() => void save()} style={styles.save} />
    </>}
  </View></SafeAreaView>;
}

function Field({ label, value, onChangeText, keyboardType, autoCapitalize }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'number-pad'; autoCapitalize?: 'none' | 'sentences' }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType ?? 'default'} autoCapitalize={autoCapitalize} style={styles.input} placeholder={label} placeholderTextColor={COLORS.muted} selectionColor={COLORS.cyan} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: COLORS.background }, container: { flex: 1, paddingHorizontal: 20 }, scroll: { flex: 1 }, body: { paddingBottom: 20 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, intro: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginBottom: 18 }, field: { flex: 1, marginBottom: 14 }, label: { color: '#CBB2DF', fontSize: 10, fontWeight: '700', marginBottom: 7 }, input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, minHeight: 47, paddingHorizontal: 13, color: COLORS.white, fontSize: 12 }, row: { flexDirection: 'row', gap: 10 }, readOnly: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, padding: 13, marginBottom: 12 }, readOnlyText: { color: COLORS.white, fontSize: 12 }, hint: { color: COLORS.muted, fontSize: 9, marginTop: 7 }, save: { marginBottom: 16 }, error: { color: '#FFC56E', fontSize: 11, textAlign: 'center', marginTop: 35 } });
