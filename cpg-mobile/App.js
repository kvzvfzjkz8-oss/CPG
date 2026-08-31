import React, { useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, View, Text } from 'react-native';

import { colors, fonts } from './src/theme';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
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
  const { user } = useAuth();
  usePushNotifications({ navigationRef, clientNumber: user?.clientNumber });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            // tabBarActiveTintColor ne colorait pas fiablement le
            // texte dans cet environnement (la page active
            // s'affichait en noir au lieu du vert du thème) : on
            // reprend la main explicitement via tabBarLabel plutôt
            // que de compter sur ce réglage automatique.
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.line,
              height: 84,
              paddingTop: 8,
              paddingBottom: 24,
            },
            tabBarLabel: ({ focused }) => (
              <Text
                style={{
                  fontSize: 10,
                  fontFamily: fonts.body,
                  fontWeight: focused ? '700' : '400',
                  color: focused ? colors.forest : colors.muted,
                  marginTop: 2,
                }}
              >
                {route.name}
              </Text>
            ),
            tabBarIcon: ({ focused }) => (
              <View
                style={{
                  width: 40,
                  height: 28,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: focused ? colors.forestPale : 'transparent',
                }}
              >
                <Feather name={ICONS[route.name]} size={19} color={focused ? colors.forest : colors.muted} />
              </View>
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

function Root() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (status === 'signedIn') {
    return <AuthenticatedApp />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.forest }} edges={['top', 'bottom']}>
      <LockScreen />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
