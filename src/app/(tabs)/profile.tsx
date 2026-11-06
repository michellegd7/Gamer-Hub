import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { COLORS } from '../../constants/theme';
import AppHeader from '../../components/AppHeader';
import AppButton from '../../components/AppButton';
import { supabase } from '../../lib/supabase';

export default function Profile() {
  const [isStaff, setIsStaff] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState('Gamer');
  const [email, setEmail] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [orderCount, setOrderCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const loadProfile = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [{ data: profile }, { count: sessions }, { count: confirmedBookings }, { count: orders }] = await Promise.all([
          supabase.from('profiles').select('role, first_name, username, email').eq('id', user.id).maybeSingle(),
          supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('customer_id', user.id),
          supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('customer_id', user.id).eq('status', 'CONFIRMED'),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', user.id),
        ]);
        if (!mounted) return;
        setIsStaff(profile?.role === 'staff' || profile?.role === 'admin');
        setIsAdmin(profile?.role === 'admin');
        setDisplayName(profile?.first_name || profile?.username || user.email?.split('@')[0] || 'Gamer');
        setEmail(profile?.email || user.email || '');
        // Include paid bookings waiting for staff to activate them.
        setSessionCount((sessions ?? 0) + (confirmedBookings ?? 0));
        setOrderCount(orders ?? 0);
      };
      void loadProfile();
      return () => { mounted = false; };
    }, []),
  );
  const menu = [
    ['person-outline', 'Personal Information'],
    ['card-outline', 'Payment Methods'],
    ['location-outline', 'Address'],
    ['time-outline', 'Your Activity'],
    ['settings-outline', 'Settings'],
    ['receipt-outline', 'Receipt'],
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <AppHeader title="MY PROFILE" />

        <View style={styles.user}>
          <View style={styles.avatar}>
            <Ionicons
              name="person"
              size={50}
              color={COLORS.cyan}
            />
          </View>

          <View>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.level}>{email}</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.label}>SESSIONS & BOOKINGS</Text>
            <Text style={styles.value}>{sessionCount}</Text>
          </View>

          <View style={styles.stat}>
            <Text style={styles.label}>FOOD ORDERS</Text>
            <Text style={styles.value}>{orderCount}</Text>
          </View>
        </View>

        <View style={styles.menu}>
          {menu.map(([icon, title]) => (
            <Pressable
              key={title}
              style={styles.menuRow}
              onPress={() => {
                if (title === 'Your Activity')
                  router.push('/history');
                if (title === 'Receipt')
                  router.push('/receipt');
                if (title === 'Personal Information')
                  router.push('/personal-information' as any);
                if (title === 'Payment Methods')
                  router.push('/payment-methods' as any);
                if (title === 'Address')
                  router.push('/address' as any);
                if (title === 'Settings')
                  router.push('/settings' as any);
              }}
            >
              <Ionicons
                name={icon as any}
                size={18}
                color={COLORS.white}
              />

              <Text style={styles.menuText}>{title}</Text>

              <Ionicons
                name="chevron-forward"
                size={14}
                color={COLORS.muted}
              />
            </Pressable>
          ))}
        </View>

        {isAdmin && (
          <Pressable style={styles.adminLink} onPress={() => router.push('/admin-dashboard' as any)}>
            <Ionicons name="shield-checkmark" size={19} color={COLORS.cyan} />
            <Text style={styles.adminLinkText}>Open admin dashboard</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
          </Pressable>
        )}

        {isStaff && !isAdmin && (
          <Pressable style={styles.staffLink} onPress={() => router.push('/staff' as any)}>
            <Ionicons name="speedometer-outline" size={19} color="#D6B4F4" />
            <Text style={styles.staffLinkText}>Open staff console</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
          </Pressable>
        )}

        <AppButton
          title="LOG OUT"
          variant="danger"
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace('/');
          }}
          style={{ marginTop: 25 }}
        />
        </ScrollView>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingBottom: 28,
  },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
  },
  avatar: {
    width: 75,
    height: 75,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
  },
  name: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '600',
  },
  level: {
    color: COLORS.cyan,
    fontWeight: '700',
    marginTop: 4,
  },
  stats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 25,
  },
  stat: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 9,
    padding: 15,
  },
  label: {
    color: COLORS.muted,
    fontSize: 9,
  },
  value: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  menu: {
    backgroundColor: COLORS.surface,
    borderRadius: 9,
    marginTop: 30,
  },
  menuRow: {
    height: 47,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: {
    color: COLORS.white,
    fontSize: 11,
    marginLeft: 10,
    flex: 1,
  },
  staffLink: {
    backgroundColor: '#281936',
    borderColor: '#573A70',
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    marginTop: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  staffLinkText: {
    color: '#D6B4F4',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  adminLink: {
    backgroundColor: '#102A35',
    borderColor: '#1C6675',
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    marginTop: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  adminLinkText: {
    color: COLORS.cyan,
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
});
