import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { router } from 'expo-router';
import { COLORS } from '../constants/theme';

const items = [
  { name: 'home', label: 'HOME', icon: 'home-outline' },
  { name: 'stations', label: 'STATIONS', icon: 'desktop-outline' },
  { name: 'food', label: 'FOOD & DRINKS', icon: 'fast-food-outline' },
  { name: 'profile', label: 'PROFILE', icon: 'person-circle-outline' },
] as const;

type LegacyBottomNavProps = { active: string };

export default function BottomNav(props: BottomTabBarProps | LegacyBottomNavProps) {
  if (!('state' in props)) {
    return (
      <View style={styles.container}>
        {items.map(item => {
          const selected = props.active === item.label;
          return (
            <Pressable
              key={item.name}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={styles.item}
              android_ripple={{ color: 'transparent' }}
              onPress={() => router.replace(`/${item.name}` as any)}
            >
              <Ionicons name={item.icon as any} size={25} color={selected ? COLORS.primary : COLORS.muted} />
              <Text style={[styles.label, selected && styles.selected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const { state, navigation, insets } = props;
  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      {items.map(item => {
        const routeIndex = state.routes.findIndex(route => route.name === item.name);
        const route = state.routes[routeIndex];
        if (!route) return null;

        const selected = state.index === routeIndex;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={selected ? { selected: true } : {}}
            accessibilityLabel={item.label}
            style={styles.item}
            android_ripple={{ color: 'transparent' }}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!selected && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          >
            <Ionicons
              name={item.icon as any}
              size={25}
              color={selected ? COLORS.primary : COLORS.muted}
            />
            <Text style={[styles.label, selected && styles.selected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 68,
    borderTopWidth: 1,
    borderTopColor: COLORS.primaryDark,
    flexDirection: 'row',
    backgroundColor: COLORS.background,
  },
  item: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
  },
  label: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 3,
  },
  selected: {
    color: COLORS.primary,
  },
});
