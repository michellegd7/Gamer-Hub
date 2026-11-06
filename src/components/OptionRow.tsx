import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { COLORS } from '../constants/theme';

export default function OptionRow({
  label,
  price,
  selected,
  onPress,
}: {
  label: string;
  price: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.row,
        selected && styles.selected,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.radio,
          selected && styles.radioSelected,
        ]}
      />

      <Text style={styles.label}>{label}</Text>

      <Text style={styles.price}>₱ {price}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 43,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  selected: {
    backgroundColor: COLORS.purpleSoft,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  radio: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#555563',
  },
  radioSelected: {
    backgroundColor: COLORS.primary,
  },
  label: {
    flex: 1,
    marginLeft: 10,
    color: COLORS.white,
    fontSize: 11,
  },
  price: {
    color: COLORS.white,
    fontSize: 10,
  },
});