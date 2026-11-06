import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { COLORS } from '../constants/theme';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  style?: ViewStyle;
};

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'outline' && styles.outline,
        variant === 'danger' && styles.danger,
        style,
      ]}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: COLORS.primary,
  },
  outline: {
    backgroundColor: COLORS.purpleSoft,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  danger: {
    backgroundColor: '#4A0015',
    borderWidth: 1,
    borderColor: COLORS.red,
  },
  text: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
});