import React, { useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { colors, fonts } from './src/theme';
import { account } from './src/data/mockData';
import { usePushNotifications } from './src/notifications/pushNotifications';

import LockScreen from './src/screens/LockScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CreditsScreen from './src/screens/CreditsScreen';
import MobileMoneyScreen from './src/screens/MobileMoneyScreen';
import ChatScreen from './src/screens/ChatScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const ICONS = {
  Accueil: 'home',
  'Crédits': 'credit-card',
  'Mobile Money': 'smartphone',
  Messages: 'message-circle',
  Profil: 'user',
};

/**
 * Les notifications ne sont enregistrées qu'une fois l'utilisateur
 * authentifié : on ne demande pas l'autorisation système sur l'écran
 * de verrouillage, et le token est associé à un client identifié.
 */
function AuthenticatedApp() {
  const navigationRef = useRef(null);
  usePushNotifications({ navigationRef, clientNumber: account.clientNumber });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.forest,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.line,
              height: 84,
              paddingTop: 8,
              paddingBottom: 24,
            },
            tabBarLabelStyle: { fontSize: 10, fontFamily: fonts.body },
            tabBarIcon: ({ color }) => (
              <Feather name={ICONS[route.name]} size={20} color={color} />
            ),
          })}
        >
          <Tab.Screen name="Accueil" component={DashboardScreen} />
          <Tab.Screen name="Crédits" component={CreditsScreen} />
          <Tab.Screen name="Mobile Money" component={MobileMoneyScreen} />
          <Tab.Screen name="Messages" component={ChatScreen} />
          <Tab.Screen name="Profil" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar style={unlocked ? 'dark' : 'light'} />
      {unlocked ? (
        <AuthenticatedApp />
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.forest }} edges={['top', 'bottom']}>
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
