import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import AppHeader from '../components/AppHeader';
import AppButton from '../components/AppButton';
import PaypalCheckoutModal from '../components/PaypalCheckoutModal';
import { recordReservationPayment } from '../data/gamingHub';
import { supabase } from '../lib/supabase';

export default function Payment() {
  const params = useLocalSearchParams();
  const [method, setMethod] = useState('Counter');
  const [saving, setSaving] = useState(false);
  const [paypalVisible, setPaypalVisible] = useState(false);
  const [paypalPaymentId, setPaypalPaymentId] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadPreference = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('preferred_payment_method').eq('id', user.id).maybeSingle();
      if (mounted && (data?.preferred_payment_method === 'Counter' || data?.preferred_payment_method === 'PayPal')) setMethod(data.preferred_payment_method);
    };
    void loadPreference();
    return () => { mounted = false; };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="PAYMENT METHOD" />

        <View style={styles.total}>
          <View>
            <Text style={styles.muted}>Total Amount</Text>
            <Text style={styles.amount}>
              ₱{params.amount || '50'}.00
            </Text>
            {typeof params.startAt === 'string' && <Text style={styles.schedule}>Starts {new Date(params.startAt).toLocaleDateString()} at {new Date(params.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Text>}
          </View>

          <Text style={styles.white}>
            {params.package || '1 hour'}
          </Text>
        </View>

        <Text style={styles.heading}>Online payment</Text>

        {['PayPal'].map(item => (
          <Pressable
            key={item}
            style={styles.method}
            onPress={() => setMethod(item)}
          >
            <Text style={styles.white}>💳 {item}</Text>

            <View
              style={[
                styles.radio,
                method === item && styles.selected,
              ]}
            />
          </Pressable>
        ))}

        <Text style={styles.heading}>Cash</Text>

        <Pressable
          style={styles.method}
          onPress={() => setMethod('Counter')}
        >
          <Text style={styles.white}>
            🪙 Pay at the Counter
          </Text>

          <View
            style={[
              styles.radio,
              method === 'Counter' && styles.selected,
            ]}
          />
        </Pressable>

        <AppButton
          title={saving ? (method === 'PayPal' ? 'OPENING PAYPAL…' : 'SAVING…') : method === 'PayPal' ? 'PAY WITH PAYPAL' : 'REQUEST PAYMENT VERIFICATION'}
          onPress={async () => {
            if (saving) return;
            if (typeof params.reservationId !== 'string') {
              Alert.alert('Reservation missing', 'Please go back and reserve an available station first.');
              return;
            }
            try {
              setSaving(true);
              const payment = await recordReservationPayment(params.reservationId, method);
              if (method === 'PayPal') {
                setPaypalPaymentId(payment.id);
                setPaypalVisible(true);
                return;
              }
              router.push({ pathname: '/qr-activation', params: {
                reservationId: params.reservationId,
                activationPin: params.activationPin,
              } });
            } catch (error) {
              const apiError = error && typeof error === 'object'
                ? error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
                : null;
              const message = [apiError?.message, apiError?.details, apiError?.hint]
                .filter((part): part is string => typeof part === 'string' && part.length > 0)
                .join('\n');
              const errorCode = typeof apiError?.code === 'string' ? apiError.code : '';
              const needsPaypalMigration = method === 'PayPal' && (
                /supported payment method|payments_method_check|preferred_payment_method_check/i.test(message) ||
                errorCode === '23514' || errorCode === 'PGRST202'
              );
              if (needsPaypalMigration) {
                Alert.alert('PayPal setup incomplete', 'Your Supabase database has not applied the PayPal migration yet. In the GamerHub Supabase project, open SQL Editor and run supabase/migrations/20261017_gamerhub_paypal.sql, then try again.');
              } else {
                Alert.alert('Could not start payment', message || 'Check your connection and Supabase setup, then try again.');
              }
            } finally {
              setSaving(false);
            }
          }}
          style={styles.button}
        />

        <Text style={styles.secure}>{method === 'PayPal' ? 'Pay securely with PayPal Sandbox. Your reservation is confirmed after the server verifies the completed payment; staff still activates your station.' : 'Payment is recorded as pending. Staff must verify your counter payment before activating your station.'}</Text>
      </View>
      <PaypalCheckoutModal
        visible={paypalVisible}
        paymentId={paypalPaymentId}
        onPaid={() => {
          setPaypalVisible(false);
          router.push({ pathname: '/qr-activation', params: {
            reservationId: params.reservationId as string,
            activationPin: params.activationPin as string,
          } });
        }}
        onCancel={() => {
          setPaypalVisible(false);
          Alert.alert('Payment not completed', 'Your reservation is still awaiting payment. You can try PayPal again from checkout.');
        }}
      />
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
  total: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 20,
  },
  muted: {
    color: COLORS.muted,
    fontSize: 10,
  },
  white: {
    color: COLORS.white,
    fontSize: 11,
  },
  amount: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 23,
  },
  schedule: { color: COLORS.muted, fontSize: 9, marginTop: 5 },
  heading: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 30,
    marginBottom: 10,
  },
  method: {
    backgroundColor: COLORS.surface,
    height: 45,
    borderRadius: 9,
    marginBottom: 9,
    paddingHorizontal: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  radio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#555563',
  },
  selected: {
    backgroundColor: COLORS.primary,
  },
  button: {
    marginTop: 'auto',
  },
  secure: {
    color: COLORS.muted,
    textAlign: 'center',
    fontSize: 9,
    marginVertical: 15,
  },
});
