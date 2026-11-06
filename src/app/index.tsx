
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { COLORS } from '../constants/theme';
import { loginAccount } from '../data/accountStorage';
import { supabase } from '../lib/supabase';
import { signOutWithPushCleanup } from '../lib/pushNotifications';

export default function LoginScreen() {
  const [loginRole, setLoginRole] = useState<'gamer' | 'admin'>('gamer');
  const [email, setEmail] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (loading) return;

    if (!email.trim() || !password) {
      Alert.alert(
        'Missing Information',
        'Please enter your Gmail address and password.'
      );
      return;
    }

    try {
      setLoading(true);

      const account = await loginAccount(
        email,
        password
      );

      if (!account) {
        Alert.alert(
          'Login Failed',
            'Incorrect Gmail address or password.'
        );
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', account.id)
        .maybeSingle();

      if (profileError || !profile) {
        await signOutWithPushCleanup();
        throw new Error(profileError?.message ?? 'Your GamerHub profile could not be found. Please contact an administrator.');
      }

      const accountIsAdmin = profile.role === 'admin';
      if ((loginRole === 'admin') !== accountIsAdmin) {
        await signOutWithPushCleanup();
        Alert.alert(
          'Admin access is not assigned',
          accountIsAdmin
            ? 'This account has the admin role. Select Admin above the login form and sign in again.'
            : 'Supabase currently marks this Gmail as a Gamer. To grant admin access, open your GamerHub project’s SQL Editor and set this account’s public.profiles.role to admin, then sign in again. The Admin choice cannot grant permissions by itself.'
        );
        return;
      }

      router.replace(loginRole === 'admin' ? '/admin-dashboard' : '/home');
    } catch (error) {
      Alert.alert(
        'Login Error',
        error instanceof Error
          ? error.message
          : 'Unable to sign in. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={
          Platform.OS === 'ios' ? 'padding' : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* GAMERSHUB LOGO */}
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/images/gamershub-logo-transparent.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <Text style={styles.welcome}>
            WELCOME BACK, {loginRole === 'admin' ? 'ADMIN' : 'GAMER'}!
          </Text>

          <Text style={styles.roleLabel}>SIGN IN AS</Text>
          <View style={styles.rolePicker}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: loginRole === 'gamer' }}
              style={[styles.roleOption, loginRole === 'gamer' && styles.roleOptionSelected]}
              onPress={() => setLoginRole('gamer')}
            >
              <Ionicons name="game-controller-outline" size={17} color={loginRole === 'gamer' ? COLORS.white : COLORS.muted} />
              <Text style={[styles.roleOptionText, loginRole === 'gamer' && styles.roleOptionTextSelected]}>Gamer</Text>
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: loginRole === 'admin' }}
              style={[styles.roleOption, loginRole === 'admin' && styles.roleOptionSelected]}
              onPress={() => setLoginRole('admin')}
            >
              <Ionicons name="shield-checkmark-outline" size={17} color={loginRole === 'admin' ? COLORS.white : COLORS.muted} />
              <Text style={[styles.roleOptionText, loginRole === 'admin' && styles.roleOptionTextSelected]}>Admin</Text>
            </Pressable>
          </View>

          {/* GMAIL ADDRESS */}
          <Text style={styles.label}>
            Gmail Address
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@gmail.com"
            placeholderTextColor={COLORS.muted}
            style={[styles.input, emailFocused && styles.inputFocused]}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
          />

          {/* PASSWORD */}
          <Text style={styles.label}>
            Password
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={COLORS.muted}
              style={styles.passwordInput}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />

            <Pressable
              onPress={() =>
                setShowPassword(!showPassword)
              }
              style={styles.eyeButton}
            >
              <Ionicons
                name={
                  showPassword
                    ? 'eye-outline'
                    : 'eye-off-outline'
                }
                size={20}
                color={COLORS.muted}
              />
            </Pressable>
          </View>

          {/* FORGOT PASSWORD */}
          <Pressable
            style={styles.forgotContainer}
            onPress={() =>
              Alert.alert(
                'Forgot Password',
                'Password recovery is not yet available.'
              )
            }
          >
            <Text style={styles.forgot}>
              Forgot Password?
            </Text>
          </Pressable>

          {/* LOGIN BUTTON */}
          <Pressable
            style={[
              styles.loginButton,
              loading && styles.disabledButton,
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator
                color={COLORS.white}
              />
            ) : (
              <Text style={styles.loginButtonText}>
                {loginRole === 'admin' ? 'ADMIN LOG IN' : 'LOG IN'}
              </Text>
            )}
          </Pressable>

          {/* SIGN UP */}
          <View style={styles.signupRow}>
            <Text style={styles.muted}>
              Do not have an account?
            </Text>

            <Pressable
              onPress={() => router.push('/register')}
            >
              <Text style={styles.signup}>
                {' '}Sign Up
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 25,
    paddingVertical: 30,
  },

  logoContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },

  logo: {
    width: 190,
    height: 190,
  },

  welcome: {
    textAlign: 'center',
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 20,
  },

  roleLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },

  rolePicker: {
    width: '100%',
    flexDirection: 'row',
    gap: 9,
    marginBottom: 18,
  },

  roleOption: {
    flex: 1,
    minHeight: 43,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },

  roleOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#301742',
  },

  roleOptionText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
  },

  roleOptionTextSelected: {
    color: COLORS.white,
  },

  label: {
    color: COLORS.white,
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '600',
  },

  input: {
    width: '100%',
    height: 50,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.white,
    paddingHorizontal: 15,
    fontSize: 13,
    marginBottom: 15,
  },

  inputFocused: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },

  passwordContainer: {
    width: '100%',
    height: 50,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 13,
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    color: COLORS.white,
    paddingHorizontal: 15,
    fontSize: 13,
  },

  eyeButton: {
    paddingHorizontal: 15,
    paddingVertical: 12,
  },

  forgotContainer: {
    alignSelf: 'flex-end',
  },

  forgot: {
    color: COLORS.primary,
    fontSize: 11,
  },

  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 25,
  },

  disabledButton: {
    opacity: 0.6,
  },

  loginButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
  },

  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },

  muted: {
    color: COLORS.muted,
    fontSize: 11,
  },

  signup: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '600',
  },
});
