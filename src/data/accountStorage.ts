import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Gender = 'Male' | 'Female' | 'Prefer not to say';

export type RegisterData = {
  firstName: string;
  middleName: string;
  lastName: string;
  age: number;
  gender: Gender;
  email: string;
  username: string;
  password: string;
};

function getAuthErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('unknownhostexception')
    || normalized.includes('unable to resolve host')
    || normalized.includes('no address associated with hostname')
    || normalized.includes('getaddrinfo enotfound')
    || normalized.includes('eai_again')
    || normalized.includes('network request failed')
    || normalized.includes('fetch failed')
  ) {
    return 'GamerHub could not find its Supabase server. Check your phone’s internet connection. If other apps are online, copy the exact Project URL from Supabase Settings → API into the app’s EXPO_PUBLIC_SUPABASE_URL and EAS preview environment, then restart Expo Go. No account was created.';
  }
  if (normalized.includes('already registered') || normalized.includes('already been registered')) {
    return 'This Gmail address already has an account. Try signing in instead.';
  }
  if (normalized.includes('password should be')) {
    return 'Choose a stronger password with at least 8 characters.';
  }
  if (normalized.includes('email rate limit')) {
    return 'Too many confirmation emails were requested. Please wait a little and try again.';
  }
  return message;
}

export async function registerAccount(data: RegisterData): Promise<{ needsEmailConfirmation: boolean }> {
  const { data: result, error } = await supabase.auth.signUp({
    email: data.email.trim().toLowerCase(),
    password: data.password,
    options: {
      emailRedirectTo: 'gamerhub://auth/callback',
      data: {
        first_name: data.firstName.trim(),
        middle_name: data.middleName.trim(),
        last_name: data.lastName.trim(),
        age: data.age,
        gender: data.gender,
        username: data.username.trim().toLowerCase(),
      },
    },
  });

  if (error) throw new Error(getAuthErrorMessage(error.message));
  if (!result.user) throw new Error('Supabase did not return an account. Please try again.');

  return { needsEmailConfirmation: !result.session };
}

export async function loginAccount(email: string, password: string): Promise<User | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    const normalized = error.message.toLowerCase();
    if (normalized.includes('email not confirmed')) {
      throw new Error('Confirm your Gmail address using the link we sent before signing in.');
    }
    if (normalized.includes('invalid login credentials')) return null;
    throw new Error(getAuthErrorMessage(error.message));
  }

  return data.user;
}
