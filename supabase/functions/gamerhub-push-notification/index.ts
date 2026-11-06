import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('GAMERHUB_PUSH_WEBHOOK_SECRET');
  if (!secret || request.headers.get('x-gamerhub-push-secret') !== secret) {
    return response({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return response({ error: 'Push service is not configured' }, 500);

  try {
    const payload = await request.json();
    const notification = payload?.record;
    if (payload?.table !== 'user_notifications' || !notification?.user_id || !notification?.title) {
      return response({ error: 'Invalid notification payload' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: devices, error } = await admin.from('gamerhub_push_tokens')
      .select('id,expo_push_token').eq('user_id', notification.user_id);
    if (error) throw error;
    let pushSent = 0;
    if (devices?.length) {
      const messages = devices.map(device => ({
        to: device.expo_push_token,
        title: notification.title,
        body: notification.message,
        sound: 'default',
        priority: 'high',
        channelId: 'gamerhub-updates',
        data: { notificationId: notification.id, reservationId: notification.reservation_id ?? null },
      }));
      const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      const result = await pushResponse.json();
      if (!pushResponse.ok) console.error('Expo push request failed with status', pushResponse.status);
      else {
        pushSent = messages.length;
        const tickets = Array.isArray(result?.data) ? result.data : [result?.data];
        const expiredTokenIds = tickets.flatMap((ticket: { details?: { error?: string } }, index: number) =>
          ticket?.details?.error === 'DeviceNotRegistered' ? [devices[index]?.id] : []);
        if (expiredTokenIds.length) await admin.from('gamerhub_push_tokens').delete().in('id', expiredTokenIds);
      }
    }

    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('email,email_notifications_enabled').eq('id', notification.user_id).maybeSingle();
    if (profileError) throw profileError;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('GAMERHUB_EMAIL_FROM');
    let emailSent = false;
    if (profile?.email && profile.email_notifications_enabled !== false && resendKey && from) {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `gamerhub-notification-${notification.id}`,
        },
        body: JSON.stringify({
          from,
          to: [profile.email],
          subject: `GamerHub: ${notification.title}`,
          text: `${notification.title}\n\n${notification.message}\n\nOpen the GamerHub app to view your reservations, PIN, session timer, and activity.`,
        }),
      });
      if (!emailResponse.ok) {
        console.error('GamerHub email delivery failed with status', emailResponse.status);
      } else emailSent = true;
    }

    return response({ pushSent, emailSent, emailConfigured: Boolean(resendKey && from) });
  } catch (error) {
    console.error('GamerHub push dispatch failed:', error);
    return response({ error: error instanceof Error ? error.message : 'Push dispatch failed' }, 500);
  }
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
