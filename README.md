# Gaming Hub Seat Reservation and Playtime Transaction System

GamerHub is an Expo and React Native mobile app for customers booking gaming stations and staff running a gaming hub.

## What the app supports

### Customer app

- Live PC and VIP station availability, search, filters, station details, and hourly rates.
- Hourly and package-based reservations with server-side pricing and overlap checks.
- Pending payment requests for GCash, Maya, or counter payment. Staff verifies a received payment before a reservation is confirmed.
- Six-digit reservation PIN and live activation status; the staff console activates confirmed reservations.
- Live session timer, paid time-extension requests, and computer-transfer requests.
- Food and beverage ordering with staff-updated order status.
- Waitlist entry, queue position, and cancellation.
- Gmail-based Supabase Auth registration and sign-in.

### Staff console

- Station availability and maintenance status management.
- Payment verification, reservation activation, active session timers, and session ending.
- Order preparation and pickup status.
- Transfer approval and maintenance reports.
- Usage, verified revenue, station utilization, and session start-time reports.

### Admin console

- Business overview for customer, station, active-session, paid-revenue, and order totals.
- Customer directory with controls to promote a customer to staff or remove staff access.
- Playtime package pricing and availability management.
- Promotion creation and activation controls.
- Separate admin-only access; admins can also open the staff operations console.

Staff and admin access are checked against `profiles.role`. New accounts default to `customer`. Grant the first administrator manually from the Supabase SQL Editor, for example:

```sql
update public.profiles
set role = 'admin'
where email = 'your-gmail@example.com';
```

After this first admin is set up, use the admin console to grant and remove staff access. Admin roles remain dashboard-managed, and only a trusted project owner should run the initial statement.

## Supabase setup

1. Copy `.env.example` to `.env` and fill in the project URL and **publishable** key from the Supabase dashboard.
2. In Supabase **SQL Editor**, run [`supabase/migrations/20261013_gamerhub_core.sql`](supabase/migrations/20261013_gamerhub_core.sql), then [`supabase/migrations/20261014_gamerhub_admin.sql`](supabase/migrations/20261014_gamerhub_admin.sql), [`supabase/migrations/20261015_gamerhub_profile_sections.sql`](supabase/migrations/20261015_gamerhub_profile_sections.sql), [`supabase/migrations/20261016_gamerhub_food_order_payments.sql`](supabase/migrations/20261016_gamerhub_food_order_payments.sql), [`supabase/migrations/20261017_gamerhub_paypal.sql`](supabase/migrations/20261017_gamerhub_paypal.sql), and [`supabase/migrations/20261018_gamerhub_reservation_scheduling.sql`](supabase/migrations/20261018_gamerhub_reservation_scheduling.sql). Run them in order; migration 17 adds PayPal capture verification, and migration 18 supports future date/time station bookings.
   These migrations have now been applied to the `gamerhub` Supabase project through SQL Editor. If you later switch to Supabase CLI deployments, reconcile the remote migration history before running `db push`, so the CLI does not try to reapply these schema changes.
3. In Supabase Auth settings, enable email confirmation if you want new customers to verify their Gmail before sign-in.
4. Install packages with `npm install`. After editing `.env`, restart Metro with `npx expo start --clear` and open the project in Expo Go so the `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` values are reloaded. The EAS `preview` profile has the matching public values in `eas.json` for a future preview build.

Never put a Supabase secret or service-role key in the mobile app. The publishable key is visible in the app bundle, so database security depends on the migration's RLS policies.

## PayPal Sandbox setup

PayPal Sandbox is implemented for station reservations, food orders, and playtime extensions. It does not process live money. The Edge Function reads the amount from GamerHub's database, calls PayPal, and marks a payment paid only after a matching completed capture.

1. In the Supabase dashboard for `gamerhub`, open **Edge Functions → Secrets** and add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` using the Sandbox app credentials. Do not put either value in `.env`, `eas.json`, `EXPO_PUBLIC_*`, or mobile code.
2. Run migration 17 above in Supabase SQL Editor.
3. From the GamerHub project folder, sign into the Supabase CLI and deploy the function to this project:

   ```powershell
   npx supabase login
   npx supabase functions deploy paypal-checkout --project-ref bcygymygeeilobzceuyr
   ```

4. Restart Expo Go with `npx expo start --clear`, choose **PayPal Sandbox** at checkout, and approve the transaction using a PayPal Sandbox personal test account. Verify the payment and related reservation/order/extension record in Supabase.

The PayPal client secret remains in Supabase Edge Function Secrets. The function uses the Sandbox API host and PHP amounts; switch to PayPal's live environment only after a separate production-readiness review and live credentials.

## Current integration boundaries

- GCash and Maya are recorded as pending payment requests for staff verification. PayPal Sandbox uses the server-side Edge Function described above.
- The reservation activation uses a PIN and staff confirmation. A camera-based QR scanner is not configured.
- Waitlist position is stored and viewable in-app; push notifications are not configured.
- The staff role must be granted manually. Do not make staff role assignment available in customer registration.

## Development checks

```bash
npm run lint
npx tsc --noEmit
```
