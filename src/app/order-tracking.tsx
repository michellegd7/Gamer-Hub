import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import { supabase } from '../lib/supabase';

type TrackedOrder = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  order_items: { quantity: number; unit_price: number; food_items?: { name: string; emoji: string } }[];
};
type TrackedPayment = { id: string; method: string; status: string; amount: number };

const progress = ['PLACED', 'PREPARING', 'READY', 'COMPLETED'];
const labels: Record<string, string> = { PLACED: 'Order placed', PREPARING: 'Preparing', READY: 'Ready for pickup', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

export default function OrderTracking() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [payment, setPayment] = useState<TrackedPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!orderId) return;
    let mounted = true;
    const refresh = async () => {
      setError('');
      const [orderResult, paymentResult] = await Promise.all([
        supabase.from('orders')
          .select('id,status,total_amount,created_at,order_items(quantity,unit_price,food_items(name,emoji))')
          .eq('id', orderId).maybeSingle(),
        supabase.from('payments').select('id,method,status,amount').eq('order_id', orderId).maybeSingle(),
      ]);
      if (!mounted) return;
      if (orderResult.error) setError(orderResult.error.message);
      else if (orderResult.data) setOrder(orderResult.data as unknown as TrackedOrder);
      if (paymentResult.error) setError(paymentResult.error.message);
      else setPayment(paymentResult.data as TrackedPayment | null);
      setLoading(false);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => { mounted = false; clearInterval(timer); };
  }, [orderId]);

  const currentStep = order ? progress.indexOf(order.status) : -1;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader title="ORDER TRACKING" />
        {!orderId ? <Text style={styles.error}>Order reference is missing.</Text> : loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 42 }} /> : error ? <Text style={styles.error}>{error}</Text> : order ? <>
          <View style={styles.card}>
            <Text style={styles.order}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.date}>{new Date(order.created_at).toLocaleString()}</Text>
            <Text style={styles.status}>{labels[order.status] ?? order.status}</Text>
            <View style={styles.steps}>{progress.map((step, index) => <View style={styles.step} key={step}><View style={[styles.dot, index <= currentStep && styles.done, order.status === 'CANCELLED' && styles.cancelled]} /><Text style={styles.stepName}>{labels[step]}</Text><Text style={styles.stepTime}>{index < currentStep ? 'Done' : index === currentStep ? 'Now' : ''}</Text></View>)}</View>
          </View>
          <View style={styles.card}>{order.order_items.map((item, index) => <View style={styles.item} key={`${item.food_items?.name ?? 'item'}-${index}`}><Text style={styles.white}>{item.food_items?.emoji ?? '🍽️'} {item.food_items?.name ?? 'Menu item'} × {item.quantity}</Text><Text style={styles.white}>₱{(Number(item.unit_price) * item.quantity).toFixed(2)}</Text></View>)}<View style={styles.item}><Text style={styles.total}>TOTAL</Text><Text style={styles.total}>₱{Number(order.total_amount).toFixed(2)}</Text></View></View>
          <View style={styles.paymentCard}><Text style={styles.paymentTitle}>PAYMENT</Text><Text style={styles.paymentText}>{payment ? `${payment.method} · ${payment.status}` : 'Payment record not available for this order.'}</Text>{payment?.status === 'PENDING' && <Text style={styles.paymentNote}>Show your order reference to staff. They will verify payment after receiving it.</Text>}</View>
          <Text style={styles.refresh}>Order status refreshes automatically.</Text>
        </> : <Text style={styles.error}>We could not find this order.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: COLORS.background }, content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 25 }, card: { backgroundColor: COLORS.surface, borderRadius: 15, padding: 15, marginTop: 16, borderWidth: 1, borderColor: COLORS.border }, order: { color: COLORS.white, fontSize: 15, fontWeight: '700' }, date: { color: COLORS.muted, fontSize: 9, marginTop: 5 }, status: { color: '#D7B0FF', fontWeight: '800', fontSize: 12, marginTop: 16 }, steps: { marginTop: 13 }, step: { minHeight: 39, flexDirection: 'row', alignItems: 'center' }, dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#555563', marginRight: 10 }, done: { backgroundColor: COLORS.primary }, cancelled: { backgroundColor: '#E2677E' }, stepName: { color: COLORS.white, flex: 1, fontSize: 10 }, stepTime: { color: COLORS.muted, fontSize: 9 }, item: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 8 }, white: { color: COLORS.white, fontSize: 10 }, total: { color: COLORS.white, fontWeight: '800', fontSize: 11 }, paymentCard: { backgroundColor: COLORS.surface, borderRadius: 13, padding: 14, marginTop: 12, borderWidth: 1, borderColor: COLORS.border }, paymentTitle: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, paymentText: { color: COLORS.white, fontSize: 11, fontWeight: '700', marginTop: 7 }, paymentNote: { color: '#FFC56E', fontSize: 9, lineHeight: 14, marginTop: 6 }, refresh: { color: COLORS.muted, fontSize: 9, textAlign: 'center', marginTop: 14 }, error: { color: '#FFC56E', marginTop: 35, textAlign: 'center', fontSize: 11, lineHeight: 18 } });
