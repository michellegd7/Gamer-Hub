
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '../constants/theme';

import {
  registerAccount,
  type Gender,
} from '../data/accountStorage';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (loading) return;

    // STEP 1: CHECK REQUIRED FIELDS
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !age.trim() ||
      !gender ||
      !email.trim() ||
      !username.trim() ||
      !password ||
      !confirmPassword
    ) {
      Alert.alert(
        'Incomplete Form',
        'Please complete all required fields.'
      );
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(normalizedEmail)) {
      Alert.alert(
        'Use a Gmail address',
        'Enter a valid address ending in @gmail.com.'
      );
      return;
    }

    // STEP 2: VALIDATE AGE
    const parsedAge = Number(age);

    if (
      !/^\d+$/.test(age.trim()) ||
      parsedAge < 1 ||
      parsedAge > 120
    ) {
      Alert.alert(
        'Invalid Age',
        'Please enter a valid age between 1 and 120.'
      );
      return;
    }

    // STEP 3: VALIDATE USERNAME
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) {
      Alert.alert(
        'Invalid Username',
        'Username must contain 3–20 letters, numbers, or underscores.'
      );
      return;
    }

    // STEP 4: VALIDATE PASSWORD
    if (password.length < 8) {
      Alert.alert(
        'Weak Password',
        'Password must contain at least 8 characters.'
      );
      return;
    }

    // STEP 5: CONFIRM PASSWORD
    if (password !== confirmPassword) {
      Alert.alert(
        'Password Mismatch',
        'Your passwords do not match.'
      );
      return;
    }

    // STEP 6: CHECK AGREEMENT
    if (!agreed) {
      Alert.alert(
        'Agreement Required',
        'Please agree to the Terms and Conditions.'
      );
      return;
    }

    // STEP 7: SAVE ONLY AFTER BUTTON CLICK
    try {
      setLoading(true);

      const { needsEmailConfirmation } = await registerAccount({
        firstName,
        middleName,
        lastName,
        age: parsedAge,
        gender,
        email: normalizedEmail,
        username,
        password,
      });

      if (needsEmailConfirmation) {
        Alert.alert(
          'Check your Gmail',
          'We sent you a confirmation link. Confirm your email, then sign in.',
          [{ text: 'Continue', onPress: () => router.replace('/') }]
        );
      } else {
        router.replace('/home');
      }

    } catch (error) {
      Alert.alert(
        'Registration Failed',
        error instanceof Error
          ? error.message
          : 'Unable to save account. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === 'ios' ? 'padding' : undefined
        }
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* BACK BUTTON */}
          <Pressable
            style={styles.backButton}
            onPress={() => router.replace('/')}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={COLORS.white}
            />
            <Text style={styles.backText}>
              Back to Login
            </Text>
          </Pressable>

          {/* HEADER */}
          <View style={styles.heading}>
            <View style={styles.iconCircle}>
              <Ionicons
                name="game-controller"
                size={32}
                color={COLORS.cyan}
              />
            </View>

            <Text style={styles.title}>
              CREATE ACCOUNT
            </Text>

            <Text style={styles.subtitle}>
              JOIN THE GAME
            </Text>

            <Text style={styles.description}>
              Create your GamersHub account
            </Text>
          </View>

          {/* PERSONAL INFORMATION */}
          <Text style={styles.sectionTitle}>
            PERSONAL INFORMATION
          </Text>

          <Text style={styles.label}>
            First Name *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter first name"
            placeholderTextColor={COLORS.muted}
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>
            Middle Name (Optional)
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter middle name"
            placeholderTextColor={COLORS.muted}
            value={middleName}
            onChangeText={setMiddleName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>
            Last Name *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter last name"
            placeholderTextColor={COLORS.muted}
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>
            Age *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter age"
            placeholderTextColor={COLORS.muted}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            maxLength={3}
          />

          {/* GENDER */}
          <Text style={styles.label}>
            Gender *
          </Text>

          <View style={styles.genderContainer}>
            {(
              [
                'Male',
                'Female',
                'Prefer not to say',
              ] as Gender[]
            ).map(option => (
              <Pressable
                key={option}
                onPress={() => setGender(option)}
                style={[
                  styles.genderOption,
                  gender === option &&
                    styles.genderSelected,
                ]}
              >
                <Ionicons
                  name={
                    gender === option
                      ? 'radio-button-on'
                      : 'radio-button-off'
                  }
                  size={16}
                  color={
                    gender === option
                      ? COLORS.primary
                      : COLORS.muted
                  }
                />

                <Text style={styles.genderText}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ACCOUNT INFORMATION */}
          <Text style={styles.sectionTitle}>
            ACCOUNT INFORMATION
          </Text>

          <Text style={styles.label}>
            Gmail Address *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="you@gmail.com"
            placeholderTextColor={COLORS.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
          />

          <Text style={styles.hint}>
            Use this address to sign in and receive account confirmation.
          </Text>

          <Text style={styles.label}>
            Username *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Create username"
            placeholderTextColor={COLORS.muted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* PASSWORD */}
          <Text style={styles.label}>
            Password *
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Create password"
              placeholderTextColor={COLORS.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />

            <Pressable
              style={styles.eyeButton}
              onPress={() =>
                setShowPassword(!showPassword)
              }
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

          <Text style={styles.hint}>
            Minimum of 8 characters
          </Text>

          {/* CONFIRM PASSWORD */}
          <Text style={styles.label}>
            Confirm Password *
          </Text>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Confirm password"
              placeholderTextColor={COLORS.muted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
            />

            <Pressable
              style={styles.eyeButton}
              onPress={() =>
                setShowConfirm(!showConfirm)
              }
            >
              <Ionicons
                name={
                  showConfirm
                    ? 'eye-outline'
                    : 'eye-off-outline'
                }
                size={20}
                color={COLORS.muted}
              />
            </Pressable>
          </View>

          {/* TERMS AGREEMENT */}
          <Pressable
            style={styles.termsContainer}
            onPress={() => setAgreed(!agreed)}
          >
            <View
              style={[
                styles.checkbox,
                agreed && styles.checkboxChecked,
              ]}
            >
              {agreed && (
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={COLORS.white}
                />
              )}
            </View>

            <Text style={styles.termsText}>
              I agree to the Terms and Conditions
              and Privacy Policy
            </Text>
          </Pressable>

          {/* CREATE ACCOUNT BUTTON */}
          <Pressable
            style={[
              styles.registerButton,
              loading && styles.disabledButton,
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator
                color={COLORS.white}
              />
            ) : (
              <Text style={styles.registerText}>
                CREATE ACCOUNT
              </Text>
            )}
          </Pressable>

          {/* LOGIN LINK */}
          <View style={styles.loginRow}>
            <Text style={styles.muted}>
              Already have an account?
            </Text>

            <Pressable
              onPress={() => router.replace('/')}
            >
              <Text style={styles.loginLink}>
                {' '}Log In
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

  flex: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },

  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },

  backText: {
    color: COLORS.muted,
    fontSize: 12,
  },

  heading: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 25,
  },

  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },

  title: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
  },

  subtitle: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 5,
  },

  description: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 12,
  },

  sectionTitle: {
    color: COLORS.cyan,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 14,
  },

  label: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 7,
    marginTop: 8,
  },

  input: {
    height: 49,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: COLORS.white,
    fontSize: 13,
    marginBottom: 12,
  },

  genderContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 12,
  },

  genderOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },

  genderSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#301B42',
  },

  genderText: {
    color: COLORS.white,
    fontSize: 11,
  },

  passwordContainer: {
    height: 49,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    color: COLORS.white,
    paddingHorizontal: 14,
    fontSize: 13,
  },

  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  hint: {
    color: COLORS.muted,
    fontSize: 10,
    marginBottom: 8,
  },

  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },

  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: COLORS.muted,
    marginRight: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },

  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  termsText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 17,
  },

  registerButton: {
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

  registerText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },

  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },

  muted: {
    color: COLORS.muted,
    fontSize: 12,
  },

  loginLink: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
});
