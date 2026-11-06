# GamerHub process flow and release requirements

## Customer and admin process flow

1. **Create an account:** the customer registers with a Gmail address and confirms it using the Supabase verification email before signing in.
2. **Sign in by role:** the same login form routes customers to the GamerHub screens and administrators to the separate admin dashboard.
3. **Choose a live station:** the customer views stations and availability loaded from Supabase. Local sample stations must not be presented as live availability.
4. **Reserve a playtime package:** select the station, package, and start date/time. Supabase checks availability and prevents overlapping reservations.
5. **Pay:** PayPal completes through the server-side PayPal confirmation flow; counter payment stays pending until staff verifies receipt. An unpaid reservation is not confirmed.
6. **Get the activation PIN:** after payment is confirmed, the reservation becomes confirmed and the customer can reopen the PIN in Your Activity → Sessions. The PIN is not announced as ready while payment is pending.
7. **Activate at the hub:** staff verifies the customer’s PIN in Admin → Sessions. The station becomes occupied and the customer session starts.
8. **Track playtime:** the customer’s Home session card opens the live timer. The active-session screen refreshes its end time from Supabase.
9. **Extend playtime:** PayPal confirmation or staff verification of counter payment extends the same active session’s `ends_at`; the timer then reflects the added time.
10. **Use related services:** the customer can request a station transfer or place a food and drinks order. The admin workspace reviews transfer requests and advances order preparation/pickup statuses.
11. **Maintain and report:** admins record maintenance issues, track repair progress, and return stations to service after open issues are resolved. Usage, verified revenue, completed orders, and peak session hours are reported from Supabase.
12. **Notify the customer:** in-app notifications follow confirmed reservation, session activation/completion, extension payment, transfer decision, and food-order status changes.

## Adviser requirements checklist

- [ ] Hosted Supabase database and server APIs only; customer decisions must use live server data, not local sample records.
- [ ] Gmail verification before account use.
- [ ] Push notifications or email notifications configured for the final deployment. In-app notification records are implemented, but they do not by themselves count as push or email delivery.
- [ ] Responsive, usable screens on supported Android phone sizes.
- [ ] Customer and admin workflows use the same hosted records and status transitions.
- [ ] Complete end-to-end review of registration, reservation, payment, activation, timer, extension, transfers, orders, maintenance, and reports.
- [ ] **Final step only: package and deliver the Android APK after all previous checks pass.** No APK has been built as part of this work.

## Packaging requirement clarification

The current source is an Expo Router / React Native app. A standalone APK can be generated from an Expo project without installing or running the app inside Expo Go, but the build still uses Expo tooling. If “no Expo” means the project must not use the Expo framework/toolchain at all, a migration to bare React Native is required before the final APK step. Confirm that interpretation with the adviser before starting that migration.
