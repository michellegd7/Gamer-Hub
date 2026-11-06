import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { COLORS } from '../constants/theme';
import AppButton from './AppButton';
import { capturePaypalApproval, createPaypalApproval } from '../lib/paypalCheckout';

type Props = {
  visible: boolean;
  paymentId: string;
  onPaid: () => void;
  onCancel: () => void;
};

export default function PaypalCheckoutModal({ visible, paymentId, onPaid, onCancel }: Props) {
  const [returnUrl, setReturnUrl] = useState('');
  const [approvalUrl, setApprovalUrl] = useState('');
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const handlingReturn = useRef(false);

  const startCheckout = useCallback(async () => {
    setLoading(true);
    setCompleting(false);
    setError('');
    setApprovalUrl('');
    setOrderId('');
    handlingReturn.current = false;
    const callbackUrl = Linking.createURL('paypal-return');
    setReturnUrl(callbackUrl);
    try {
      const approval = await createPaypalApproval(paymentId, callbackUrl);
      setOrderId(approval.orderId);
      setApprovalUrl(approval.approvalUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not open PayPal checkout.');
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    if (!visible || !paymentId) return;
    const timer = setTimeout(() => { void startCheckout(); }, 0);
    return () => clearTimeout(timer);
  }, [visible, paymentId, startCheckout]);

  const finishCheckout = async (url: string) => {
    if (handlingReturn.current) return;
    handlingReturn.current = true;
    let returnedOrderId: string | null = null;
    let payerId: string | null = null;
    try {
      const callback = new URL(url);
      returnedOrderId = callback.searchParams.get('token');
      payerId = callback.searchParams.get('PayerID') ?? callback.searchParams.get('payerId');
    } catch { /* A non-approval return is treated as a cancellation. */ }

    if (!returnedOrderId || returnedOrderId !== orderId || !payerId) {
      setCompleting(false);
      setApprovalUrl('');
      setError('PayPal checkout was cancelled. You can close this window or try again.');
      return;
    }

    setCompleting(true);
    setError('');
    try {
      await capturePaypalApproval(paymentId, returnedOrderId);
      onPaid();
    } catch (captureError) {
      setApprovalUrl('');
      const detail = captureError instanceof Error ? captureError.message : 'PayPal payment could not be verified.';
      setError(`PayPal returned to GamerHub, but payment confirmation failed. Do not pay again. Retry verification or contact staff.\n\n${detail}`);
      setOrderId(returnedOrderId);
    } finally {
      setCompleting(false);
    }
  };

  const handleNavigation = (navigation: WebViewNavigation) => {
    if (returnUrl && navigation.url.startsWith(returnUrl)) {
      void finishCheckout(navigation.url);
      return false;
    }
    return true;
  };

  const retryVerification = async () => {
    if (!orderId || completing) return;
    setCompleting(true);
    setError('');
    try {
      await capturePaypalApproval(paymentId, orderId);
      onPaid();
    } catch (captureError) {
      const detail = captureError instanceof Error ? captureError.message : 'PayPal payment could not be verified.';
      setError(`Payment verification is still failing. Do not pay again.\n\n${detail}`);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={styles.headerText}><Text style={styles.title}>PayPal Sandbox</Text><Text style={styles.subtitle}>Secure checkout</Text></View>
            <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Close PayPal checkout" style={styles.close}><Ionicons name="close" size={21} color={COLORS.white} /></Pressable>
          </View>
          {approvalUrl ? (
            <WebView
              source={{ uri: approvalUrl }}
              style={styles.webview}
              originWhitelist={['https://*', 'gamerhub://*', 'exp://*']}
              onShouldStartLoadWithRequest={handleNavigation}
              onLoadStart={() => { if (!completing) setLoading(true); }}
              onLoadEnd={() => setLoading(false)}
              onError={event => setError(event.nativeEvent.description || 'PayPal page failed to load. Check your connection and retry.')}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              startInLoadingState
              renderLoading={() => <View style={styles.loading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.subtitle}>Loading PayPal…</Text></View>}
            />
          ) : (
            <View style={styles.loading}>
              {loading || completing ? <ActivityIndicator color={COLORS.primary} size="large" /> : <Ionicons name={error ? 'warning-outline' : 'card-outline'} size={30} color={error ? '#FFC56E' : '#D7B0FF'} />}
              <Text style={styles.message}>{completing ? 'Verifying your payment with Supabase…' : error || 'Preparing secure PayPal checkout…'}</Text>
              {!loading && !completing && error ? <View style={styles.actions}><AppButton title={orderId ? 'RETRY PAYMENT VERIFICATION' : 'TRY PAYPAL AGAIN'} onPress={() => orderId ? void retryVerification() : void startCheckout()} style={styles.button} /><AppButton title="CLOSE" variant="outline" onPress={onCancel} style={styles.button} /></View> : null}
            </View>
          )}
          {completing ? <View style={styles.verifying}><ActivityIndicator color={COLORS.primary} /><Text style={styles.subtitle}>Verifying payment…</Text></View> : null}
          {error && approvalUrl && !completing ? <View style={styles.errorBanner}><Text style={styles.bannerText}>{error}</Text><Pressable onPress={() => void startCheckout()}><Text style={styles.retry}>RETRY</Text></Pressable></View> : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end' },
  sheet: { height: '94%', backgroundColor: COLORS.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerText: { flex: 1 }, title: { color: COLORS.white, fontSize: 14, fontWeight: '800' }, subtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  close: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  webview: { flex: 1, backgroundColor: '#fff' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  message: { color: COLORS.white, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  actions: { width: '100%', gap: 10, marginTop: 8 }, button: { width: '100%' },
  verifying: { position: 'absolute', left: 20, right: 20, bottom: 24, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  errorBanner: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: '#342720', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  bannerText: { flex: 1, color: '#FFE0B2', fontSize: 10, lineHeight: 15 }, retry: { color: '#D7B0FF', fontSize: 10, fontWeight: '800' },
});
