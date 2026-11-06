import { supabase } from '../lib/supabase';

export type HubStation = {
  id: string;
  name: string;
  station_type: string;
  gpu: string;
  processor: string;
  ram: string;
  monitor: string;
  rate: number;
  status: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'MAINTENANCE';
};

export type HubPackage = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
};

export type HubFoodItem = {
  id: string;
  name: string;
  category: string;
  emoji: string;
  price: number;
};

function databaseError(error: unknown, feature: string): Error {
  const value = error && typeof error === 'object'
    ? error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    : null;
  const message = [value?.message, value?.details, value?.hint]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
  const code = typeof value?.code === 'string' ? value.code : '';

  if (code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(message)) {
    return new Error(`Supabase is missing the ${feature} database function. Apply the GamerHub core migration (20261013_gamerhub_core.sql) in the connected Supabase project, then run NOTIFY pgrst, 'reload schema' in SQL Editor.`);
  }
  if (code === '23503' || /foreign key constraint/i.test(message)) {
    return new Error(`The selected station or playtime package is not in this Supabase project. Recheck the GamerHub core migration and refresh the app. Details: ${message}`);
  }
  if (code === '42501') {
    return new Error(`Supabase denied the ${feature} request. Make sure you are signed in and the authenticated role has permission to run the GamerHub reservation function. ${message}`.trim());
  }
  return new Error(message || `Could not complete ${feature}. Check your internet connection and Supabase project configuration.`);
}

export async function fetchStations(): Promise<HubStation[]> {
  const { data, error } = await supabase.rpc('get_gamerhub_station_availability');
  if (error) {
    if (error.code === 'PGRST202' || /get_gamerhub_station_availability|schema cache/i.test(error.message)) {
      throw new Error('Station availability needs a Supabase update. Run supabase/migrations/20261113_gamerhub_shared_station_availability.sql in SQL Editor, then refresh.');
    }
    throw error;
  }
  const stationRows = (data ?? []) as (Omit<HubStation, 'rate'> & { hourly_rate: number | string })[];
  return stationRows.map(station => ({ ...station, rate: Number(station.hourly_rate) }));
}

export async function fetchPlaytimePackages(): Promise<HubPackage[]> {
  const { data, error } = await supabase.from('playtime_packages')
    .select('id,name,duration_minutes,price')
    .eq('is_active', true)
    .order('duration_minutes');
  if (error) throw error;
  return (data ?? []).map(item => ({ ...item, price: Number(item.price) }));
}

export async function fetchFoodItems(): Promise<HubFoodItem[]> {
  const { data, error } = await supabase.from('food_items')
    .select('id,name,category,emoji,price')
    .eq('is_available', true)
    .order('category')
    .order('name');
  if (error) throw error;
  return (data ?? []).map(item => ({ ...item, price: Number(item.price) }));
}

export async function reserveStation(stationId: string, packageId: string, startAt = new Date().toISOString()) {
  const { data, error } = await supabase.rpc('create_gamerhub_reservation', {
    p_station_id: stationId,
    p_package_id: packageId,
    p_start_at: startAt,
  });
  if (error) throw databaseError(error, 'station reservation');
  return data;
}

export async function reserveStationWithSavedTime(stationId: string) {
  const { data, error } = await supabase.rpc('create_gamerhub_balance_reservation', {
    p_station_id: stationId,
  });
  if (error) throw databaseError(error, 'saved playtime reservation');
  return data;
}

export async function recordReservationPayment(reservationId: string, method: string) {
  const { data, error } = await supabase.rpc('create_gamerhub_payment', {
    p_reservation_id: reservationId,
    p_method: method,
  });
  if (error) throw error;
  return data;
}

export async function placeFoodOrder(items: { id: string; quantity: number }[], method: string) {
  const { data, error } = await supabase.rpc('create_gamerhub_food_order', {
    p_items: items,
    p_method: method,
  });
  if (error) throw error;
  return data;
}

export async function joinWaitlist(stationType: string) {
  const { data, error } = await supabase.rpc('join_gamerhub_waitlist', { p_station_type: stationType });
  if (error) throw error;
  return data;
}
