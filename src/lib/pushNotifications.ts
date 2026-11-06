import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { AppOwnership } from 'expo-constants';
import type { DevicePushToken } from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { supabase } from './supabase';

const TOKEN_KEY = 'gamerhub.push-token';
let generation = 0;
let registration: Promise<void> = Promise.resolve();

export function supportsPushNotifications() {
  return (Platform.OS === 'android' || Platform.OS === 'ios')
    && Constants.appOwnership !== AppOwnership.Expo;
}

export function stopPushRegistration() {
  generation += 1;
}

export function registerPushNotifications(userId: string, devicePushToken?: DevicePushToken) {
  if (!supportsPushNotifications()) return;
  const currentGeneration = generation;
  registration = registration.catch(error => {
    console.error('Previous push registration failed:', error);
  }).then(async () => {
    if (generation !== currentGeneration) return;
    const Notifications = await import('expo-notifications');
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('gamerhub-updates', {
        name: 'GamerHub updates',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Notifications are off', 'Allow notifications in your device settings to receive GamerHub updates.');
      }
    }
    if (generation !== currentGeneration) return;
    if (!permission.granted) {
      const previousToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (previousToken) {
        const { error } = await supabase.rpc('unregister_gamerhub_push_token', { p_token: previousToken });
        if (error) throw error;
        await AsyncStorage.removeItem(TOKEN_KEY);
      }
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error('The EAS project ID is missing.');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken })).data;
    if (generation !== currentGeneration) return;
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (session?.user.id !== userId || generation !== currentGeneration) return;

    const previousToken = await AsyncStorage.getItem(TOKEN_KEY);
    if (previousToken && previousToken !== token) {
      const { error } = await supabase.rpc('unregister_gamerhub_push_token', { p_token: previousToken });
      if (error) throw error;
    }
    await AsyncStorage.setItem(TOKEN_KEY, token);
    if (generation !== currentGeneration) return;
    const { error } = await supabase.rpc('register_gamerhub_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) throw error;
  }).catch(error => {
    console.error('GamerHub push registration failed:', error);
    Alert.alert('Push notifications unavailable', 'Could not register this device for notifications. Check your connection and try reopening the app.');
  });
}

export async function signOutWithPushCleanup() {
  stopPushRegistration();
  await registration;
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    const { error } = await supabase.rpc('unregister_gamerhub_push_token', { p_token: token });
    if (error) throw new Error(`Could not disable this device's notifications: ${error.message}`);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
