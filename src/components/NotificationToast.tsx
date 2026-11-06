import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

export type GamerToastNotification = {
  id: string;
  title: string;
  message: string;
};

type Props = {
  notification: GamerToastNotification | null;
  onPress: () => void;
  onDismiss: () => void;
};

export default function NotificationToast({ notification, onPress, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  if (!notification) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${notification.title}. ${notification.message}`} onPress={onPress} style={styles.banner}>
        <View style={styles.iconWrap}><Ionicons name="notifications" size={19} color={COLORS.white} /></View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>{notification.title}</Text>
          <Text numberOfLines={2} style={styles.message}>{notification.message}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={10} onPress={onDismiss} style={styles.close}>
          <Ionicons name="close" size={18} color={COLORS.muted} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 14, right: 14, zIndex: 1000, elevation: 20 },
  banner: { minHeight: 76, flexDirection: 'row', alignItems: 'center', backgroundColor: '#242430', borderColor: '#68408A', borderWidth: 1, borderRadius: 18, paddingVertical: 12, paddingLeft: 12, paddingRight: 8, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  iconWrap: { width: 40, height: 40, borderRadius: 13, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  copy: { flex: 1 },
  title: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
  message: { color: '#D2D0DA', fontSize: 11, lineHeight: 16, marginTop: 3 },
  close: { padding: 7, marginLeft: 4 },
});
