import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { supabase } from '../lib/supabase';

const REMINDER_KEY = 'gamerhub.session-reminder';

export default function Settings() {
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      const reminder = await AsyncStorage.getItem(REMINDER_KEY).catch(() => null);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user ? await supabase.from('profiles').select('email_notifications_enabled').eq('id', user.id).maybeSingle() : { data: null };
      if (mounted) {
        if (reminder !== null) setReminderEnabled(reminder !== 'false');
        if (profile) setEmailNotificationsEnabled(profile.email_notifications_enabled !== false);
      }
    };
    void loadSettings().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const setReminder = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(REMINDER_KEY, String(value));
      setReminderEnabled(value);
    } catch { Alert.alert('Could not save setting', 'Please try again.'); }
  };

  const setEmailNotifications = async (value: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('Sign in required', 'Sign in to update your email notification setting.'); return; }
    const { error } = await supabase.from('profiles').update({ email_notifications_enabled: value }).eq('id', user.id);
    if (error) { Alert.alert('Could not save setting', error.message); return; }
    setEmailNotificationsEnabled(value);
  };

  const changePassword = async () => {
    if (saving) return;
    if (newPassword.length < 8) { Alert.alert('Password too short', 'Use at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Passwords do not match', 'Enter the same password in both fields.'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) { Alert.alert('Could not change password', error.message); return; }
    setNewPassword(''); setConfirmPassword('');
    Alert.alert('Password changed', 'Your GamerHub password has been updated.');
  };

  return <SafeAreaView style={styles.screen}><View style={styles.container}><AppHeader title="SETTINGS" />
    {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.cyan} /></View> : <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>SESSION EXPERIENCE</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: reminderEnabled }} onPress={() => void setReminder(!reminderEnabled)} style={styles.preference}>
          <View style={styles.prefIcon}><Ionicons name="timer-outline" size={20} color={COLORS.cyan} /></View>
          <View style={styles.copy}><Text style={styles.prefTitle}>Low-time reminder</Text><Text style={styles.description}>Show an in-app reminder when 5 minutes remain in your active session.</Text></View>
          <View style={[styles.toggle, reminderEnabled && styles.toggleOn]}><View style={[styles.toggleKnob, reminderEnabled && styles.toggleKnobOn]} /></View>
        </Pressable>
        <Text style={styles.smallNote}>This reminder appears in the app while your session is open.</Text>
        <View style={[styles.preference, { marginTop: 10 }]}>
          <View style={styles.prefIcon}><Ionicons name="notifications-outline" size={20} color="#D7B0FF" /></View>
          <View style={styles.copy}><Text style={styles.prefTitle}>Live in-app alerts</Text><Text style={styles.description}>Admin confirmations and session updates appear as a banner while GamerHub is open and remain saved under Notifications.</Text></View>
          <Text style={styles.liveLabel}>LIVE</Text>
        </View>
        <Text style={styles.smallNote}>These alerts use Supabase Realtime, so there is no unsupported Expo push registration in Expo Go.</Text>

        <Text style={[styles.section, styles.securityHeading]}>EMAIL UPDATES</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: emailNotificationsEnabled }} onPress={() => void setEmailNotifications(!emailNotificationsEnabled)} style={styles.preference}>
          <View style={styles.prefIcon}><Ionicons name="mail-outline" size={20} color="#D7B0FF" /></View>
          <View style={styles.copy}><Text style={styles.prefTitle}>GamerHub email notifications</Text><Text style={styles.description}>Reservation confirmed, session started or completed, payment, transfer, and food order updates.</Text></View>
          <View style={[styles.toggle, emailNotificationsEnabled && styles.toggleOn]}><View style={[styles.toggleKnob, emailNotificationsEnabled && styles.toggleKnobOn]} /></View>
        </Pressable>
        <Text style={styles.smallNote}>We send service updates to the Gmail on your GamerHub account. Your session PIN stays inside the app.</Text>

        <Text style={[styles.section, styles.securityHeading]}>ACCOUNT SECURITY</Text>
        <View style={styles.securityCard}>
          <Text style={styles.cardTitle}>Change password</Text>
          <Text style={styles.description}>Choose a new password for your GamerHub sign-in.</Text>
          <TextInput value={newPassword} onChangeText={setNewPassword} placeholder="New password (8+ characters)" placeholderTextColor={COLORS.muted} secureTextEntry autoCapitalize="none" style={styles.input} />
          <TextInput value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor={COLORS.muted} secureTextEntry autoCapitalize="none" style={styles.input} />
          <AppButton title={saving ? 'UPDATING…' : 'UPDATE PASSWORD'} onPress={() => void changePassword()} style={styles.passwordButton} />
        </View>
      </ScrollView>
    </>}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: COLORS.background }, container: { flex: 1, paddingHorizontal: 20 }, scroll: { flex: 1 }, body: { paddingBottom: 24 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, section: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginVertical: 12 }, preference: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, padding: 13 }, prefIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#10202A', alignItems: 'center', justifyContent: 'center', marginRight: 11 }, copy: { flex: 1 }, prefTitle: { color: COLORS.white, fontSize: 11, fontWeight: '800' }, description: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 4 }, liveLabel: { color: '#59E6AA', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, toggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: '#4A4A56', padding: 3, justifyContent: 'center', marginLeft: 8 }, toggleOn: { backgroundColor: COLORS.primary }, toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.white }, toggleKnobOn: { alignSelf: 'flex-end' }, smallNote: { color: COLORS.muted, fontSize: 9, lineHeight: 14, marginTop: 8, paddingHorizontal: 3 }, securityHeading: { marginTop: 24 }, securityCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border }, cardTitle: { color: COLORS.white, fontSize: 13, fontWeight: '800' }, input: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, color: COLORS.white, fontSize: 11, marginTop: 11 }, passwordButton: { marginTop: 13 } });
