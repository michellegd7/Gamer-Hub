import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLORS } from '../../constants/theme';
import AppHeader from '../../components/AppHeader';
import { fetchFoodItems, HubFoodItem } from '../../data/gamingHub';

export default function Food() {
  const [menu, setMenu] = useState<HubFoodItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMenu = async () => {
    setLoading(true);
    setError('');
    try { setMenu(await fetchFoodItems()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load the menu.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let mounted = true;
    const syncMenu = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const latest = await fetchFoodItems();
        if (mounted) { setMenu(latest); setError(''); }
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Could not load the menu.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void syncMenu(true);
    const refreshTimer = setInterval(() => void syncMenu(false), 15000);
    return () => { mounted = false; clearInterval(refreshTimer); };
  }, []);

  const shown = useMemo(() => category === 'All' ? menu : menu.filter(item => item.category === category), [category, menu]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(menu.map(item => item.category)))], [menu]);
  const cartLines = useMemo(() => Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })), [cart]);
  const total = cartLines.reduce((sum, line) => sum + (menu.find(item => item.id === line.id)?.price ?? 0) * line.quantity, 0);
  const quantity = cartLines.reduce((sum, item) => sum + item.quantity, 0);

  const changeQuantity = (id: string, difference: number) => setCart(current => {
    const next = (current[id] ?? 0) + difference;
    const updated = { ...current };
    if (next > 0) updated[id] = next;
    else delete updated[id];
    return updated;
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <AppHeader title="FOOD & BEVERAGES" />
        <View style={styles.filters}>
          {categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={[styles.filter, category === item && styles.active]}><Text style={[styles.filterText, category === item && styles.filterTextActive]}>{item}</Text></Pressable>)}
        </View>
        {loading ? <View style={styles.state}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.stateText}>Loading the menu…</Text></View> : error ? <View style={styles.state}><Text style={styles.stateTitle}>Menu unavailable</Text><Text style={styles.stateText}>{error}</Text><Pressable style={styles.retry} onPress={() => void loadMenu()}><Text style={styles.retryText}>Try again</Text></Pressable></View> : !shown.length ? <View style={styles.state}><Text style={styles.stateTitle}>No items in this category</Text><Text style={styles.stateText}>Check back later or choose another category.</Text></View> : <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuList} showsVerticalScrollIndicator={false}>
          {shown.map(item => {
            const count = cart[item.id] ?? 0;
            return <View style={styles.product} key={item.id}>
              <View style={styles.emojiBox}><Text style={styles.emoji}>{item.emoji}</Text></View>
              <View style={styles.productInfo}><Text style={styles.name}>{item.name}</Text><Text style={styles.category}>{item.category}</Text><Text style={styles.price}>₱{item.price.toFixed(2)}</Text></View>
              <View style={styles.quantityControl}>
                {count > 0 && <Pressable accessibilityLabel={`Remove one ${item.name}`} onPress={() => changeQuantity(item.id, -1)} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable>}
                {count > 0 ? <Text style={styles.count}>{count}</Text> : null}
                <Pressable accessibilityLabel={`Add ${item.name}`} onPress={() => changeQuantity(item.id, 1)} style={[styles.stepButton, styles.addButton]}><Text style={styles.addText}>{count ? '+' : 'ADD'}</Text></Pressable>
              </View>
            </View>;
          })}
        </ScrollView>}
        <Pressable disabled={!quantity} style={[styles.cart, !quantity && styles.cartDisabled]} onPress={() => {
          if (!quantity) { Alert.alert('Your cart is empty', 'Add a food or drink item to continue.'); return; }
          router.push({ pathname: '/cart', params: { items: JSON.stringify(cartLines) } });
        }}>
          <View><Text style={styles.cartTitle}>VIEW CART · {quantity} {quantity === 1 ? 'ITEM' : 'ITEMS'}</Text><Text style={styles.cartSub}>Review before sending your order</Text></View><Text style={styles.cartTotal}>₱{total.toFixed(2)}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, content: { flex: 1, paddingHorizontal: 20 },
  filters: { flexDirection: 'row', gap: 9, marginBottom: 13 }, filter: { minHeight: 38, minWidth: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, paddingHorizontal: 15, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border }, active: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, filterText: { color: COLORS.white, fontSize: 11, fontWeight: '700' }, filterTextActive: { color: '#FFFFFF' },
  menuScroll: { flex: 1 }, menuList: { paddingBottom: 10 }, product: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 11, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }, emojiBox: { width: 54, height: 54, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25243A', marginRight: 11 }, emoji: { fontSize: 29 }, productInfo: { flex: 1 }, name: { color: COLORS.white, fontSize: 13, fontWeight: '700' }, category: { color: COLORS.muted, fontSize: 9, marginTop: 3 }, price: { color: '#D7B0FF', fontSize: 11, fontWeight: '800', marginTop: 5 },
  quantityControl: { flexDirection: 'row', alignItems: 'center', gap: 7 }, stepButton: { minWidth: 31, height: 31, paddingHorizontal: 7, borderRadius: 9, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' }, stepText: { color: COLORS.white, fontSize: 19, lineHeight: 22 }, addButton: { backgroundColor: '#342046' }, addText: { color: '#E2C4FF', fontSize: 10, fontWeight: '800' }, count: { color: COLORS.white, fontSize: 12, fontWeight: '800', minWidth: 13, textAlign: 'center' },
  cart: { backgroundColor: COLORS.purpleSoft, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, cartDisabled: { opacity: 0.55 }, cartTitle: { color: COLORS.white, fontWeight: '800', fontSize: 11 }, cartSub: { color: COLORS.muted, fontSize: 8, marginTop: 3 }, cartTotal: { color: '#E2C4FF', fontWeight: '900', fontSize: 14 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 9 }, stateTitle: { color: COLORS.white, fontSize: 14, fontWeight: '800', textAlign: 'center' }, stateText: { color: COLORS.muted, fontSize: 10, textAlign: 'center', lineHeight: 16 }, retry: { marginTop: 8, backgroundColor: COLORS.primary, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 10 }, retryText: { color: COLORS.white, fontSize: 10, fontWeight: '800' },
});
