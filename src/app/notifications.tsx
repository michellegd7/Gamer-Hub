import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import { supabase } from '../lib/supabase';

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export default function Notifications() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setError(userError?.message ?? 'Sign in to view your notifications.');
      setItems([]);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data, error: queryError } = await supabase
      .from('user_notifications')
      .select('id,title,message,is_read,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (queryError) {
      const isMissingNotifications = queryError.code === 'PGRST205'
        || /user_notifications|schema cache/i.test(queryError.message);
      setError(isMissingNotifications
        ? 'Notifications are not set up in Supabase yet. In your GamerHub project, run supabase/migrations/20261112_gamerhub_session_notification_sync.sql in SQL Editor, then tap Try Again.'
        : queryError.message);
    }
    else setItems((data ?? []) as NotificationRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const connect = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (user) {
        setUserId(user.id);
        channel = supabase.channel(`customer-notifications-${user.id}-${Date.now()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => { void load(false); })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => { void load(false); })
          .subscribe();
        refreshTimer = setInterval(() => { void load(false); }, 15000);
      }
      void load();
    };
    void connect();
    return () => {
      mounted = false;
      if (refreshTimer) clearInterval(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  const markAllRead = async () => {
    if (!userId) return;
    const { error: updateError } = await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setItems(current => current.map(item => ({ ...item, is_read: true })));
  };

  const hasUnread = items.some(item => !item.is_read);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="NOTIFICATIONS" />

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={COLORS.primary} /><Text style={styles.message}>Loading notifications…</Text></View>
        ) : error ? (
          <View style={styles.state}><Ionicons name="warning-outline" size={24} color="#FFC56E" /><Text style={styles.message}>{error}</Text><AppButton title="TRY AGAIN" onPress={() => void load()} style={styles.retryButton} /></View>
        ) : items.length ? (
          <>
            {items.map(item => (
              <View style={[styles.notification, !item.is_read && styles.unread]} key={item.id}>
                <View style={styles.row}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
                </View>
                <Text style={styles.message}>{item.message}</Text>
              </View>
            ))}
            <AppButton
              title={hasUnread ? 'MARK ALL AS READ' : 'ALL READ'}
              variant="outline"
              onPress={() => void markAllRead()}
              style={{ marginTop: 'auto', marginBottom: 30 }}
            />
          </>
        ) : (
          <View style={styles.state}><Ionicons name="notifications-outline" size={28} color={COLORS.muted} /><Text style={styles.title}>You’re all caught up</Text><Text style={styles.message}>Reservation and account updates will appear here.</Text></View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, paddingHorizontal: 20 },
  notification: { backgroundColor: COLORS.surface, padding: 15, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  unread: { borderColor: COLORS.primary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  title: { color: COLORS.white, fontSize: 12, fontWeight: '700', flex: 1 },
  time: { color: COLORS.muted, fontSize: 9, maxWidth: '48%', textAlign: 'right' },
  message: { color: COLORS.muted, fontSize: 10, marginTop: 7, lineHeight: 16 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  retryButton: { width: '70%', maxWidth: 220, paddingHorizontal: 18 },
});
