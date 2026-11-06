import { Tabs } from 'expo-router';
import BottomNav from '../../components/BottomNav';
import { COLORS } from '../../constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="home"
      detachInactiveScreens={false}
      tabBar={props => <BottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        animation: 'none',
        lazy: false,
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: COLORS.background },
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="stations" />
      <Tabs.Screen name="food" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
