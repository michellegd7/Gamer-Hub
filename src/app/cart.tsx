import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import PaypalCheckoutModal from '../components/PaypalCheckoutModal';
import { fetchFoodItems, HubFoodItem, placeFoodOrder } from '../data/gamingHub';
import { supabase } from '../lib/supabase';

type CartLine = { id: string; quantity: number };

function readCart(value: string | string[] | undefined): CartLine[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((line): line is CartLine => !!line && typeof line.id === 'string' && Number.isInteger(line.quantity) && line.quantity > 0);
  } catch { /* Older app links passed comma-separated ids. */ }
  return raw.split(',').filter(Boolean).map(id => ({ id, quantity: 1 }));
}

export default function Cart() {
  const params = useLocalSearchParams<{ items?: string | string[] }>();
  const [placing, setPlacing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<HubFoodItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('Counter');
  const [paypalVisible, setPaypalVisible] = useState(false);
  const [paypalPaymentId, setPaypalPaymentId] = useState('');
  const [error, setError] = useState('');
  const cart = useMemo(() => readCart(params.items), [params.items]);

  useEffect(() => {
    let mounted = true;
    fetchFoodItems().then(data => { if (mounted) setMenu(data); })
      .catch(loadError => { if (mounted) setError(loadError instanceof Error ? loadError.message : 'Could not load your cart.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadPaymentPreference = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('preferred_payment_method').eq('id', user.id).maybeSingle();
      if (mounted && (data?.preferred_payment_method === 'Counter' || data?.preferred_payment_method === 'PayPal')) setPaymentMethod(data.preferred_payment_method);
    };
    void loadPaymentPreference();
    return () => { mounted = false; };
  }, []);

  const items = cart.map(line => ({ ...line, item: menu.find(item => item.id === line.id) })).filter((line): line is CartLine & { item: HubFoodItem } => !!line.item);
  const total = items.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const unavailable = cart.filter(line => !menu.some(item => item.id === line.id));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="YOUR ORDER" />
        {loading ? <View style={styles.empty}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.muted}>Loading your cart…</Text></View> : error ? <View style={styles.empty}><Text style={styles.emptyTitle}>Could not load menu items</Text><Text style={styles.muted}>{error}</Text></View> : !items.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Your cart is empty</Text><Text style={styles.muted}>Go to Food & Drinks to add available items.</Text><Pressable onPress={() => router.replace('/food')} style={styles.browse}><Text style={styles.browseText}>Browse menu</Text></Pressable></View> : <>
          {unavailable.length > 0 && <Text style={styles.warning}>Some items are no longer available. They have been removed from this order.</Text>}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {items.map(({ id, quantity, item }) => <View style={styles.product} key={id}>
              <View style={styles.emojiBox}><Text style={styles.emoji}>{item.emoji}</Text></View>
              <View style={styles.details}><Text style={styles.name}>{item.name}</Text><Text style={styles.price}>₱{item.price.toFixed(2)} each</Text></View>
              <Text style={styles.quantity}>× {quantity}</Text>
              <Text style={styles.lineTotal}>₱{(item.price * quantity).toFixed(2)}</Text>
            </View>)}
          </ScrollView>
          <Text style={styles.methodHeading}>PAYMENT METHOD</Text>
          <View style={styles.methods}>{['Counter', 'PayPal'].map(method => <Pressable key={method} accessibilityRole="button" accessibilityState={{ selected: paymentMethod === method }} onPress={() => setPaymentMethod(method)} style={[styles.method, paymentMethod === method && styles.methodSelected]}><Text style={[styles.methodText, paymentMethod === method && styles.methodTextSelected]}>{method === 'Counter' ? 'At counter' : method}</Text></Pressable>)}</View>
          <View style={styles.total}><Text style={styles.totalLabel}>TOTAL</Text><Text style={styles.totalValue}>₱{total.toFixed(2)}</Text></View>
          <Text style={styles.note}>{paymentMethod === 'PayPal' ? 'Your order goes to staff for preparation. PayPal Sandbox confirms the payment securely before checkout completes.' : 'Your order goes to staff for preparation. Payment is recorded as pending until staff verifies it.'}</Text>
        </>}
        <AppButton title={placing ? 'PROCESSING…' : items.length ? paymentMethod === 'PayPal' ? 'PAY WITH PAYPAL & PLACE ORDER' : 'PLACE ORDER' : 'BACK TO MENU'} onPress={async () => {
          if (!items.length) { router.replace('/food'); return; }
          if (placing || loading || error) return;
          try {
            setPlacing(true);
            const order = await placeFoodOrder(items.map(({ id, quantity }) => ({ id, quantity })), paymentMethod);
            if (paymentMethod === 'PayPal') {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) throw new Error('Sign in again before paying with PayPal.');
              const { data: payment, error: paymentError } = await supabase.from('payments').select('id').eq('order_id', order.id).eq('customer_id', user.id).eq('method', 'PayPal').single();
              if (paymentError) throw paymentError;
              setPaypalPaymentId(payment.id);
              setPaypalVisible(true);
              return;
            }
            router.replace('/home');
          } catch (placeError) { Alert.alert('Could not place order', placeError instanceof Error ? placeError.message : 'Please try again.'); }
          finally { setPlacing(false); }
        }} />
      </View>
      <PaypalCheckoutModal
        visible={paypalVisible}
        paymentId={paypalPaymentId}
        onPaid={() => {
          setPaypalVisible(false);
          router.replace('/home');
        }}
        onCancel={() => {
          setPaypalVisible(false);
          Alert.alert(
            'Order placed; payment pending',
            'The PayPal approval was cancelled. Your order is saved with payment pending. You can review it in Your Activity.',
            [{ text: 'OK', onPress: () => router.replace('/home') }],
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 }, list: { flex: 1 }, listContent: { paddingTop: 14, paddingBottom: 10 },
  product: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 11, marginBottom: 9, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }, emojiBox: { width: 44, height: 44, borderRadius: 11, backgroundColor: '#25243A', justifyContent: 'center', alignItems: 'center', marginRight: 10 }, emoji: { fontSize: 25 }, details: { flex: 1 }, name: { color: COLORS.white, fontSize: 12, fontWeight: '700' }, price: { color: COLORS.muted, marginTop: 4, fontSize: 9 }, quantity: { color: COLORS.muted, fontSize: 10, marginRight: 10 }, lineTotal: { minWidth: 54, textAlign: 'right', color: COLORS.white, fontSize: 10, fontWeight: '700' },
  methodHeading: { color: COLORS.muted, fontSize: 9, fontWeight: '800', marginTop: 8, marginBottom: 7 }, methods: { flexDirection: 'row', gap: 7 }, method: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, methodSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.purpleSoft }, methodText: { color: COLORS.muted, fontSize: 9, fontWeight: '700' }, methodTextSelected: { color: COLORS.white },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderTopWidth: 1, borderTopColor: COLORS.border }, totalLabel: { color: COLORS.muted, fontWeight: '800', fontSize: 11 }, totalValue: { color: COLORS.white, fontWeight: '900', fontSize: 17 }, note: { color: COLORS.muted, fontSize: 9, textAlign: 'center', lineHeight: 14, marginBottom: 14 }, warning: { color: '#FFC56E', fontSize: 10, marginTop: 14 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 }, emptyTitle: { color: COLORS.white, fontSize: 14, fontWeight: '800' }, muted: { color: COLORS.muted, fontSize: 10, textAlign: 'center', lineHeight: 16 }, browse: { marginTop: 4, padding: 10 }, browseText: { color: '#D7B0FF', fontSize: 11, fontWeight: '800' },
});
