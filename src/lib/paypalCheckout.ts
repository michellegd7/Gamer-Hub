import { supabase } from './supabase';

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === 'object') {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object') {
      const response = context as {
        clone?: () => { json?: () => Promise<unknown>; text?: () => Promise<string> };
        json?: () => Promise<unknown>;
        text?: () => Promise<string>;
        status?: number;
      };
      const readable = typeof response.clone === 'function' ? response.clone() : response;
      try {
        const body = typeof readable.json === 'function' ? await readable.json() : null;
        if (body && typeof body === 'object') {
          const fields = body as { error?: unknown; message?: unknown; details?: unknown; hint?: unknown };
          const detail = [fields.error, fields.message, fields.details, fields.hint]
            .find((value): value is string => typeof value === 'string' && value.length > 0);
          if (detail) return `${detail}${response.status ? ` (HTTP ${response.status})` : ''}`;
        }
      } catch {
        try {
          const text = typeof readable.text === 'function' ? await readable.text() : '';
          if (text) return `${text}${response.status ? ` (HTTP ${response.status})` : ''}`;
        } catch { /* Use the Functions client's message. */ }
      }
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Could not complete PayPal checkout. Confirm the Edge Function and Sandbox secrets are configured.';
}

export type PaypalApproval = { orderId: string; approvalUrl: string };

export async function createPaypalApproval(paymentId: string, returnUrl: string): Promise<PaypalApproval> {
  const { data, error } = await supabase.functions.invoke('paypal-checkout', {
    body: { action: 'create', paymentId, returnUrl },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data?.approvalUrl || !data?.orderId) throw new Error(data?.error || 'PayPal did not return an approval link.');
  return { orderId: data.orderId, approvalUrl: data.approvalUrl };
}

export async function capturePaypalApproval(paymentId: string, paypalOrderId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('paypal-checkout', {
    body: { action: 'capture', paymentId, paypalOrderId },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (!data?.paid) throw new Error(data?.error || 'PayPal did not confirm the payment.');
}
