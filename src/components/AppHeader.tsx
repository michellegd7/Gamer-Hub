import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';

export default function AppHeader({
  title,
  back = true,
}: {
  title: string;
  back?: boolean;
}) {
  return (
    <View style={styles.header}>
      {back && (
        <Pressable
          style={styles.back}
          onPress={() => router.back()}
        >
          <Ionicons
            name="chevron-back"
            color="white"
            size={22}
          />
        </Pressable>
      )}

      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  back: {
    position: 'absolute',
    left: 0,
    padding: 8,
  },
  title: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '500',
  },
});