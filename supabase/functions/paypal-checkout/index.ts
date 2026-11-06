import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const paypalApi = 'https://api-m.sandbox.paypal.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    const token = authorization?.replace(/^Bearer\s+/i, '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const clientId = Deno.env.get('PAYPAL_CLIENT_ID');
    const clientSecret = Deno.env.get('PAYPAL_CLIENT_SECRET');
    if (!token || !supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Sign in again before using PayPal.' }, 401);
    if (!clientId || !clientSecret) return json({ error: 'PayPal Sandbox is not configured on the server. Add its credentials in Supabase Edge Function Secrets.' }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Your session expired. Sign in again.' }, 401);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { action, paymentId, returnUrl, paypalOrderId } = await request.json();
    if (typeof paymentId !== 'string') return json({ error: 'A payment ID is required.' }, 400);

    const { data: payment, error: paymentError } = await admin.from('payments')
      .select('id,customer_id,amount,method,status,reservation_id,session_id,order_id,provider_reference')
      .eq('id', paymentId).eq('customer_id', user.id).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || payment.method !== 'PayPal') return json({ error: 'PayPal payment not found.' }, 404);

    const paypalTokenResponse = await fetch(`${paypalApi}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const paypalTokenBody = await paypalTokenResponse.json();
    if (!paypalTokenResponse.ok) return json({ error: 'PayPal could not authenticate these Sandbox credentials. Check that both values come from the same Sandbox app.' }, 502);
    const accessToken = paypalTokenBody.access_token as string;

    if (action === 'create') {
      if (payment.status !== 'PENDING') return json({ error: 'This payment is no longer pending.' }, 409);
      if (typeof returnUrl !== 'string' || !/^(https:\/\/|gamerhub:\/\/|exp:\/\/)/i.test(returnUrl)) return json({ error: 'A valid GamerHub return URL is required.' }, 400);
      if (payment.reservation_id) {
        const { data, error } = await admin.from('reservations').select('id').eq('id', payment.reservation_id).eq('customer_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Reservation ownership could not be verified.' }, 403);
      }
      if (payment.order_id) {
        const { data, error } = await admin.from('orders').select('id,status').eq('id', payment.order_id).eq('customer_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data || data.status === 'CANCELLED') return json({ error: 'This food order is no longer payable.' }, 409);
      }
      if (payment.session_id) {
        const { data, error } = await admin.from('sessions').select('id,status').eq('id', payment.session_id).eq('customer_id', user.id).maybeSingle();
        if (error) throw error;
        if (!data || data.status !== 'ACTIVE') return json({ error: 'This session is no longer active.' }, 409);
      }
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'This payment amount is invalid.' }, 400);
      const response = await fetch(`${paypalApi}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': payment.id },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ reference_id: payment.id, custom_id: payment.id, description: 'GamerHub playtime and gaming services', amount: { currency_code: 'PHP', value: amount.toFixed(2) } }],
          payment_source: { paypal: { experience_context: {
            brand_name: 'GamerHub', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
            return_url: returnUrl, cancel_url: returnUrl,
          } } },
        }),
      });
      const order = await response.json();
      if (!response.ok) return json({ error: 'PayPal could not create a Sandbox checkout. Try again or contact staff.' }, 502);
      const approvalUrl = order.links?.find((link: { rel: string }) => link.rel === 'payer-action' || link.rel === 'approve')?.href;
      if (!order.id || !approvalUrl) return json({ error: 'PayPal did not return an approval page.' }, 502);
      const { error: updateError } = await admin.from('payments').update({ provider_reference: order.id })
        .eq('id', payment.id).eq('customer_id', user.id).eq('status', 'PENDING').eq('method', 'PayPal');
      if (updateError) throw updateError;
      return json({ orderId: order.id, approvalUrl });
    }

    if (action === 'capture') {
      const orderId = typeof paypalOrderId === 'string' ? paypalOrderId : null;
      if (!orderId || (payment.status === 'PENDING' && payment.provider_reference !== orderId)) return json({ error: 'This PayPal order does not match your pending payment.' }, 403);
      if (payment.status === 'PAID') return json({ paid: true });
      if (payment.status !== 'PENDING') return json({ error: 'This payment is no longer pending.' }, 409);
      let capturedOrder = await fetch(`${paypalApi}/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(response => response.json());
      if (capturedOrder.status !== 'COMPLETED') {
        const captureResponse = await fetch(`${paypalApi}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': payment.id },
        });
        capturedOrder = await captureResponse.json();
        if (!captureResponse.ok && capturedOrder.status !== 'COMPLETED') return json({ error: 'PayPal did not complete the payment. You can retry from checkout.' }, 402);
      }
      const unit = capturedOrder.purchase_units?.[0];
      const capture = unit?.payments?.captures?.find((item: { status: string }) => item.status === 'COMPLETED');
      const expectedAmount = Number(payment.amount).toFixed(2);
      const identifiers = [unit?.custom_id, unit?.reference_id].filter((value): value is string => typeof value === 'string' && value.length > 0);
      const hasMatchingPaymentId = identifiers.includes(payment.id);
      // PayPal may omit purchase_units[0].amount after capture. The capture is the
      // authoritative paid total; bind it to both the original GamerHub payment and order.
      const paymentReferenceMatches = hasMatchingPaymentId && payment.provider_reference === orderId;
      const capturedAmountMatches = capture?.amount?.currency_code === 'PHP' && capture?.amount?.value === expectedAmount;
      if (capturedOrder.status !== 'COMPLETED' || !paymentReferenceMatches || !capturedAmountMatches || !capture?.id) {
        console.error('PayPal completed order failed GamerHub validation:', JSON.stringify({
          status: capturedOrder.status,
          hasMatchingPaymentId,
          storedOrderMatches: payment.provider_reference === orderId,
          orderCurrency: unit?.amount?.currency_code,
          orderAmount: unit?.amount?.value,
          captureCurrency: capture?.amount?.currency_code,
          captureAmount: capture?.amount?.value,
          expectedAmount,
        }));
        return json({ error: 'PayPal completed the order, but its payment reference, currency, or captured amount did not match this GamerHub purchase. The payment was not marked paid. Contact staff with your order reference.' }, 409);
      }
      const { error: completeError } = await admin.rpc('complete_gamerhub_paypal_payment', {
        p_payment_id: payment.id, p_order_id: orderId, p_capture_id: capture.id,
      });
      if (completeError) {
        console.error('PayPal capture succeeded but GamerHub payment finalization failed:', completeError.message);
        return json({ error: 'PayPal captured the payment, but GamerHub could not mark it complete. Do not pay again. Retry payment verification or contact staff.' }, 500);
      }
      return json({ paid: true, captureId: capture.id });
    }

    return json({ error: 'Unsupported PayPal action.' }, 400);
  } catch (error) {
    console.error('PayPal checkout error:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'PayPal checkout could not be completed. Please try again.' }, 500);
  }
});
