import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import { supabase } from '../lib/supabase';

type Payment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  created_at: string;
  reservation_id: string | null;
  session_id: string | null;
  order_id: string | null;
};
type ReceiptItem = { name: string; quantity: number; unit_price: number };

export default function Receipt() {
  const { paymentId } = useLocalSearchParams<{ paymentId?: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [description, setDescription] = useState('GamerHub transaction');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadReceipt = async () => {
      setLoading(true);
      setError('');
      const paymentResult = typeof paymentId === 'string'
        ? await supabase.from('payments').select('id,amount,method,status,created_at,reservation_id,session_id,order_id').eq('id', paymentId).maybeSingle()
        : await supabase.from('payments').select('id,amount,method,status,created_at,reservation_id,session_id,order_id').order('created_at', { ascending: false }).limit(1).maybeSingle();

      if (!mounted) return;
      if (paymentResult.error) {
        setError(paymentResult.error.message);
        setLoading(false);
        return;
      }
      if (!paymentResult.data) {
        setPayment(null);
        setLoading(false);
        return;
      }

      const transaction = paymentResult.data as Payment;
      setPayment(transaction);
      if (transaction.order_id) {
        const { data, error: detailError } = await supabase.from('orders')
          .select('order_items(quantity,unit_price,food_items(name))').eq('id', transaction.order_id).maybeSingle();
        if (detailError) setError(detailError.message);
        else {
          setDescription(`Food order #${transaction.order_id.slice(0, 8).toUpperCase()}`);
          setItems((data?.order_items ?? []).map((line: any) => ({ name: line.food_items?.name ?? 'Menu item', quantity: line.quantity, unit_price: Number(line.unit_price) })));
        }
      } else if (transaction.reservation_id) {
        const { data, error: detailError } = await supabase.from('reservations')
          .select('stations(name),package_id').eq('id', transaction.reservation_id).maybeSingle();
        if (detailError) setError(detailError.message);
        else setDescription(`Station reservation · ${(data as any)?.stations?.name ?? 'Gaming station'}`);
      } else if (transaction.session_id) {
        const { data, error: detailError } = await supabase.from('sessions')
          .select('stations(name)').eq('id', transaction.session_id).maybeSingle();
        if (detailError) setError(detailError.message);
        else setDescription(`Playtime extension · ${(data as any)?.stations?.name ?? 'Gaming station'}`);
      }
      if (mounted) setLoading(false);
    };
    void loadReceipt();
    return () => { mounted = false; };
  }, [paymentId]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader title="RECEIPT" />
        {loading ? <ActivityIndicator color={COLORS.cyan} style={{ marginTop: 40 }} /> : error ? <Text style={styles.error}>{error}</Text> : !payment ? <View style={styles.empty}><Text style={styles.title}>No payment receipt yet</Text><Text style={styles.muted}>Verified payments will appear here after your first transaction.</Text></View> : <>
          <View style={styles.brand}>
            <Ionicons name="game-controller" size={50} color={COLORS.cyan} />
            <Text style={styles.brandName}>GAMERHUB</Text>
            <Text style={styles.receiptId}>RECEIPT #{payment.id.slice(0, 8).toUpperCase()}</Text>
          </View>
          <View style={styles.receipt}>
            <Text style={styles.description}>{description}</Text>
            <Text style={styles.date}>{new Date(payment.created_at).toLocaleString()}</Text>
            <View style={styles.divider} />
            {items.map((item, index) => <View style={styles.row} key={`${item.name}-${index}`}><Text style={styles.muted}>{item.name} × {item.quantity}</Text><Text style={styles.white}>₱{(item.unit_price * item.quantity).toFixed(2)}</Text></View>)}
            <View style={styles.row}><Text style={styles.muted}>Payment method</Text><Text style={styles.white}>{payment.method}</Text></View>
            <View style={styles.row}><Text style={styles.muted}>Payment status</Text><Text style={[styles.status, payment.status === 'PAID' ? styles.paid : styles.pending]}>{payment.status}</Text></View>
            <View style={[styles.row, styles.totalRow]}><Text style={styles.totalLabel}>TOTAL</Text><Text style={styles.totalValue}>₱{Number(payment.amount).toFixed(2)}</Text></View>
          </View>
          {payment.status === 'PENDING' && <Text style={styles.pendingNote}>This is a payment request receipt. Staff must verify payment before it is marked paid.</Text>}
        </>}
        <Pressable style={styles.backButton} onPress={() => router.replace('/history')}><Text style={styles.backText}>VIEW ACTIVITY</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, content: { flexGrow: 1, paddingHorizontal: 25, paddingBottom: 25 },
  brand: { alignItems: 'center', marginTop: 24 }, brandName: { color: COLORS.primary, fontWeight: '900', fontSize: 14, letterSpacing: 2, marginTop: 4 }, receiptId: { color: COLORS.muted, fontSize: 9, letterSpacing: 1, marginTop: 15 },
  receipt: { backgroundColor: COLORS.surface, borderRadius: 13, padding: 16, marginTop: 22, borderWidth: 1, borderColor: COLORS.border }, description: { color: COLORS.white, textAlign: 'center', fontSize: 13, fontWeight: '800' }, date: { color: COLORS.muted, textAlign: 'center', fontSize: 9, marginTop: 6 }, divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 13 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border }, muted: { color: COLORS.muted, fontSize: 10, flexShrink: 1 }, white: { color: COLORS.white, fontSize: 10, textAlign: 'right' }, status: { fontSize: 10, fontWeight: '800' }, paid: { color: '#65DDBA' }, pending: { color: '#FFC56E' }, totalRow: { borderBottomWidth: 0, marginTop: 5 }, totalLabel: { color: COLORS.white, fontSize: 11, fontWeight: '900' }, totalValue: { color: '#D7B0FF', fontSize: 15, fontWeight: '900' }, pendingNote: { color: '#FFC56E', fontSize: 9, textAlign: 'center', lineHeight: 14, marginTop: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 25 }, title: { color: COLORS.white, fontSize: 15, fontWeight: '800' }, error: { color: '#FFC56E', fontSize: 10, textAlign: 'center', marginTop: 25 }, backButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.purpleSoft, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 11, padding: 14, marginTop: 22 }, backText: { color: '#E2C7FF', fontWeight: '800', fontSize: 10 },
});
