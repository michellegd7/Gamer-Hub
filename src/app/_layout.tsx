import { Stack, router } from 'expo-router';
import type { NotificationResponse } from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import NotificationToast, { type GamerToastNotification } from '../components/NotificationToast';
import { registerPushNotifications, stopPushRegistration, supportsPushNotifications } from '../lib/pushNotifications';

export default function RootLayout() {
  const [toast, setToast] = useState<GamerToastNotification | null>(null);

  useEffect(() => {
    let active = true;
    let subscribedUserId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let removePushListeners: (() => void) | undefined;

    const disconnectNotifications = () => {
      subscribedUserId = null;
      if (channel) void supabase.removeChannel(channel);
      channel = undefined;
    };

    const subscribeToGamerNotifications = (userId: string) => {
      if (!active || subscribedUserId === userId) return;
      disconnectNotifications();
      subscribedUserId = userId;
      registerPushNotifications(userId);
      channel = supabase.channel(`gamer-live-alerts-${userId}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}`,
        }, payload => {
          const row = payload.new as Partial<GamerToastNotification>;
          if (!row.id || !row.title || !row.message) return;
          setToast({ id: row.id, title: row.title, message: row.message });
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => setToast(current => current?.id === row.id ? null : current), 7000);
        })
        .subscribe();
    };

    const connect = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (active && user) subscribeToGamerNotifications(user.id);
    };
    void connect();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        subscribeToGamerNotifications(session.user.id);
      } else {
        stopPushRegistration();
        disconnectNotifications();
        setToast(null);
      }
    });
    const appStateListener = AppState.addEventListener('change', state => {
      if (state === 'active' && subscribedUserId) registerPushNotifications(subscribedUserId);
    });
    if (supportsPushNotifications()) {
      void import('expo-notifications').then(Notifications => {
        if (!active) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
        const openNotification = (response: NotificationResponse) => {
          if (!response.notification.request.content.data?.notificationId) return;
          Notifications.clearLastNotificationResponse();
          router.push('/notifications');
        };
        const responseListener = Notifications.addNotificationResponseReceivedListener(openNotification);
        const tokenListener = Notifications.addPushTokenListener(token => {
          if (subscribedUserId) registerPushNotifications(subscribedUserId, token);
        });
        const lastResponse = Notifications.getLastNotificationResponse();
        if (lastResponse) openNotification(lastResponse);
        removePushListeners = () => {
          responseListener.remove();
          tokenListener.remove();
        };
      }).catch(error => console.error('Could not initialize push notifications:', error));
    }
    return () => {
      active = false;
      stopPushRegistration();
      if (hideTimer) clearTimeout(hideTimer);
      disconnectNotifications();
      appStateListener.remove();
      removePushListeners?.();
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
          statusBarAnimation: 'none',
          statusBarStyle: 'light',
          navigationBarColor: COLORS.background,
          contentStyle: {
            backgroundColor: COLORS.background,
          },
        }}
      />
      <NotificationToast
        notification={toast}
        onPress={() => { setToast(null); router.push('/notifications'); }}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}
