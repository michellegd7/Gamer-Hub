import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';

type Tab = 'Overview' | 'Team' | 'Catalog';
type Row = Record<string, any>;
const tabs: Tab[] = ['Overview', 'Team', 'Catalog'];

export default function AdminConsole() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState({ customers: 0, stations: 0, active: 0, revenue: 0, orders: 0 });
  const [users, setUsers] = useState<Row[]>([]);
  const [packages, setPackages] = useState<Row[]>([]);
  const [promos, setPromos] = useState<Row[]>([]);
  const [packageName, setPackageName] = useState('');
  const [packageHours, setPackageHours] = useState('1');
  const [packagePrice, setPackagePrice] = useState('');
  const [promoName, setPromoName] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [promoHours, setPromoHours] = useState('');
  const [promoPrice, setPromoPrice] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const [profileResult, stationResult, sessionResult, paymentResult, orderResult, packageResult, promoResult] = await Promise.all([
      supabase.from('profiles').select('id,email,first_name,last_name,username,role,created_at').order('created_at', { ascending: false }).limit(250),
      supabase.from('stations').select('id,status'),
      supabase.from('sessions').select('id,status'),
      supabase.from('payments').select('amount,status'),
      supabase.from('orders').select('id'),
      supabase.from('playtime_packages').select('*').order('duration_minutes'),
      supabase.from('promo_packages').select('*').order('name'),
    ]);
    const failed = [profileResult, stationResult, sessionResult, paymentResult, orderResult, packageResult, promoResult].find(result => result.error);
    if (failed?.error) setError(failed.error.message);
    else {
      setUsers(profileResult.data ?? []);
      setPackages(packageResult.data ?? []);
      setPromos(promoResult.data ?? []);
      const paymentRows = paymentResult.data ?? [];
      setMetrics({
        customers: (profileResult.data ?? []).filter(row => row.role === 'customer').length,
        stations: (stationResult.data ?? []).length,
        active: (sessionResult.data ?? []).filter(row => row.status === 'ACTIVE').length,
        revenue: paymentRows.filter(row => row.status === 'PAID').reduce((sum, row) => sum + Number(row.amount), 0),
        orders: (orderResult.data ?? []).length,
      });
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    let active = true;
    const checkRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = user ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle() : { data: null };
      if (!active) return;
      const allowed = data?.role === 'admin';
      setIsAdmin(allowed);
      setChecking(false);
      if (allowed) void load();
    };
    void checkRole();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => PromiseLike<{ error: any }>, success: string) => {
    const result = await action();
    if (result.error) { Alert.alert('Could not update', result.error.message); return; }
    await load();
    Alert.alert('Updated', success);
  };

  const setRole = (user: Row) => {
    const next = user.role === 'staff' ? 'customer' : 'staff';
    Alert.alert(`${next === 'staff' ? 'Grant staff access' : 'Remove staff access'}?`, `${user.email} will have the ${next} role.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void run(() => supabase.rpc('set_gamerhub_staff_role', { p_user_id: user.id, p_role: next }), `${user.email} is now ${next}.`) },
    ]);
  };

  const createPackage = async () => {
    const hours = Number(packageHours); const price = Number(packagePrice); const id = packageName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(price) || price < 0) { Alert.alert('Check package details', 'Enter a name, positive duration, and valid price.'); return; }
    await run(() => supabase.from('playtime_packages').insert({ id, name: packageName.trim(), duration_minutes: Math.round(hours * 60), price, is_active: true }), 'Package added.');
    setPackageName(''); setPackagePrice('');
  };

  const savePackage = (item: Row, patch: Partial<Row>) => void run(() => supabase.from('playtime_packages').update(patch).eq('id', item.id), 'Package saved.');
  const createPromo = async () => {
    const hours = Number(promoHours); const price = Number(promoPrice);
    if (!promoName.trim() || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(price) || price < 0) { Alert.alert('Check promotion details', 'Enter a name, positive duration, and valid price.'); return; }
    await run(() => supabase.from('promo_packages').insert({ name: promoName.trim(), description: promoDescription.trim(), duration_minutes: Math.round(hours * 60), price, is_active: true }), 'Promotion added.');
    setPromoName(''); setPromoDescription(''); setPromoHours(''); setPromoPrice('');
  };

  if (checking) return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.cyan} /></SafeAreaView>;
  if (!isAdmin) return <SafeAreaView style={styles.center}><Ionicons name="lock-closed" size={36} color={COLORS.cyan} /><Text style={styles.deniedTitle}>Admin access required</Text><Text style={styles.muted}>This console is only available to accounts with the admin role.</Text><Pressable onPress={() => router.replace('/profile')} style={styles.primary}><Text style={styles.primaryText}>Back to profile</Text></Pressable></SafeAreaView>;

  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><Pressable onPress={() => router.replace('/(tabs)/profile' as any)} accessibilityLabel="Return to profile"><Ionicons name="arrow-back" size={22} color={COLORS.white} /></Pressable><View style={{ flex: 1 }}><Text style={styles.kicker}>GAMERHUB OPERATIONS</Text><Text style={styles.title}>Admin Console</Text></View><Pressable onPress={() => void load()}><Ionicons name="refresh" size={20} color={COLORS.cyan} /></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{tabs.map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabOn]}><Text style={[styles.tabText, tab === item && styles.tabTextOn]}>{item}</Text></Pressable>)}</ScrollView>
    <ScrollView contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy && <ActivityIndicator color={COLORS.cyan} style={{ marginBottom: 12 }} />}
      {tab === 'Overview' && <>
        <Text style={styles.section}>BUSINESS OVERVIEW</Text><View style={styles.grid}>{[
          ['Customers', metrics.customers, 'people-outline'], ['Stations', metrics.stations, 'desktop-outline'], ['Active sessions', metrics.active, 'game-controller-outline'], ['Paid revenue', `₱${metrics.revenue.toLocaleString()}`, 'cash-outline'], ['Food orders', metrics.orders, 'fast-food-outline'],
        ].map(([label, value, icon]) => <View key={String(label)} style={styles.metric}><Ionicons name={icon as any} size={18} color={COLORS.cyan} /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>)}</View>
        <View style={styles.card}><Text style={styles.cardTitle}>Quick actions</Text><Action title="Manage team access" icon="people" onPress={() => setTab('Team')} /><Action title="Edit packages and promotions" icon="pricetags" onPress={() => setTab('Catalog')} /><Action title="Open staff operations" icon="speedometer" onPress={() => router.push('/staff' as any)} /></View>
        <Text style={styles.hint}>Revenue totals include payments marked PAID by staff. User and order counts show the latest 250 accounts and all recorded orders available to this screen.</Text>
      </>}
      {tab === 'Team' && <><Text style={styles.section}>CUSTOMER AND STAFF ACCOUNTS</Text><Text style={styles.hint}>Promote customers to staff or remove staff access. Admin roles are assigned from Supabase dashboard only.</Text>{users.map(user => <View key={user.id} style={styles.rowCard}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{user.first_name || user.username || 'Gamer'} {user.last_name || ''}</Text><Text style={styles.muted}>{user.email}</Text><Text style={styles.role}>{String(user.role).toUpperCase()}</Text></View>{user.role !== 'admin' && <Pressable style={styles.smallButton} onPress={() => setRole(user)}><Text style={styles.smallButtonText}>{user.role === 'staff' ? 'Remove staff' : 'Make staff'}</Text></Pressable>}</View>)}</>}
      {tab === 'Catalog' && <>
        <Text style={styles.section}>PLAYTIME PACKAGES</Text><View style={styles.card}><Text style={styles.cardTitle}>Add package</Text><Field label="Package name" value={packageName} onChangeText={setPackageName} /><View style={styles.inputRow}><Field label="Hours" value={packageHours} onChangeText={setPackageHours} numeric /><Field label="Price (₱)" value={packagePrice} onChangeText={setPackagePrice} numeric /></View><Pressable style={styles.primary} onPress={() => void createPackage()}><Text style={styles.primaryText}>Add package</Text></Pressable></View>
        {packages.map(item => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.muted}>ID: {item.id} · {item.duration_minutes} minutes</Text><View style={styles.inputRow}><Field label="Price (₱)" value={String(item.price)} onChangeText={value => setPackages(current => current.map(row => row.id === item.id ? { ...row, price: value } : row))} numeric /><Pressable style={styles.smallButton} onPress={() => savePackage(item, { price: Number(item.price) })}><Text style={styles.smallButtonText}>Save price</Text></Pressable></View><Pressable style={[styles.smallButton, styles.toggleButton]} onPress={() => savePackage(item, { is_active: !item.is_active })}><Text style={styles.smallButtonText}>{item.is_active ? 'Deactivate' : 'Activate'}</Text></Pressable></View>)}
        <Text style={[styles.section, { marginTop: 20 }]}>PROMOTIONS</Text><View style={styles.card}><Text style={styles.cardTitle}>Add promotion</Text><Field label="Promotion name" value={promoName} onChangeText={setPromoName} /><Field label="Description" value={promoDescription} onChangeText={setPromoDescription} /><View style={styles.inputRow}><Field label="Hours" value={promoHours} onChangeText={setPromoHours} numeric /><Field label="Price (₱)" value={promoPrice} onChangeText={setPromoPrice} numeric /></View><Pressable style={styles.primary} onPress={() => void createPromo()}><Text style={styles.primaryText}>Add promotion</Text></Pressable></View>
        {promos.map(item => <View key={item.id} style={styles.rowCard}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.muted}>{item.description || `${item.duration_minutes} min · ₱${item.price}`}</Text><Text style={styles.role}>{item.is_active ? 'ACTIVE' : 'INACTIVE'}</Text></View><Pressable style={styles.smallButton} onPress={() => void run(() => supabase.from('promo_packages').update({ is_active: !item.is_active }).eq('id', item.id), 'Promotion status changed.')}><Text style={styles.smallButtonText}>{item.is_active ? 'Deactivate' : 'Activate'}</Text></Pressable></View>)}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function Action({ title, icon, onPress }: { title: string; icon: any; onPress: () => void }) { return <Pressable style={styles.action} onPress={onPress}><Ionicons name={icon} size={18} color={COLORS.cyan} /><Text style={styles.actionText}>{title}</Text><Ionicons name="chevron-forward" size={15} color={COLORS.muted} /></Pressable>; }
function Field({ label, value, onChangeText, numeric }: { label: string; value: string; onChangeText: (value: string) => void; numeric?: boolean }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={numeric ? 'decimal-pad' : 'default'} style={styles.input} placeholderTextColor={COLORS.muted} /></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background }, center: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 17 }, kicker: { color: COLORS.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }, title: { color: COLORS.white, fontSize: 23, fontWeight: '800', marginTop: 3 },
  tabs: { paddingHorizontal: 16, gap: 9, paddingBottom: 12 }, tab: { borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 17, paddingVertical: 9 }, tabOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, tabText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' }, tabTextOn: { color: COLORS.white }, content: { padding: 18, paddingBottom: 45 }, section: { color: COLORS.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', flexGrow: 1, minHeight: 100, backgroundColor: COLORS.surface, borderRadius: 13, padding: 15, borderWidth: 1, borderColor: COLORS.border }, metricValue: { color: COLORS.white, fontSize: 22, fontWeight: '800', marginTop: 9 }, metricLabel: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  card: { backgroundColor: COLORS.surface, borderRadius: 13, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border }, rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 13, padding: 14, marginBottom: 9, borderWidth: 1, borderColor: COLORS.border }, cardTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700', marginBottom: 5 }, muted: { color: COLORS.muted, fontSize: 11, lineHeight: 17 }, role: { color: '#C999FF', fontSize: 9, fontWeight: '800', marginTop: 6, letterSpacing: 1 }, hint: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 10, marginBottom: 14 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: COLORS.border }, actionText: { color: COLORS.white, flex: 1, fontSize: 12, fontWeight: '600' }, smallButton: { backgroundColor: '#39204D', borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, smallButtonText: { color: '#E2C7FF', fontSize: 10, fontWeight: '800' }, toggleButton: { alignSelf: 'flex-start', marginTop: 8 },
  field: { flex: 1, marginBottom: 10 }, fieldLabel: { color: COLORS.muted, fontSize: 10, marginBottom: 5 }, input: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, color: COLORS.white, paddingHorizontal: 11, paddingVertical: 9, fontSize: 12 }, inputRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' }, primary: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 5 }, primaryText: { color: COLORS.white, fontSize: 12, fontWeight: '800' }, error: { color: '#FF8292', marginBottom: 12 }, deniedTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800', marginTop: 14, marginBottom: 6 },
});
