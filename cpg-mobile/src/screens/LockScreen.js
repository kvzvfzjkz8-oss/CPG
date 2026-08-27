import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { colors, fonts } from '../theme';

const DEMO_PIN = '1234';

export default function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [biometricLabel, setBiometricLabel] = useState('Empreinte');
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricLabel('Face ID');
      }
    })();
  }, []);

  const fail = useCallback(() => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setPin(''));
  }, [shake]);

  const press = (digit) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => (next === DEMO_PIN ? onUnlock() : fail()), 140);
    }
  };

  const authenticate = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !enrolled) {
      // Sur simulateur ou appareil sans biométrie configurée : on laisse passer
      // pour que la démonstration reste testable.
      onUnlock();
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Déverrouiller votre compte CPG',
      cancelLabel: 'Utiliser le code PIN',
      disableDeviceFallback: false,
    });

    if (result.success) onUnlock();
    else if (result.error && result.error !== 'user_cancel') {
      Alert.alert('Connexion impossible', 'Utilisez votre code PIN pour continuer.');
    }
  };

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] });

  return (
    <View style={styles.root}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Feather name="git-commit" size={24} color={colors.forest} />
        </View>
        <Text style={styles.brandName}>Crédit Populaire du Gabon</Text>
        <Text style={styles.brandHint}>Entrez votre code PIN</Text>
      </View>

      <Animated.View style={[styles.dots, { transform: [{ translateX }] }]}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < pin.length ? colors.gold : 'rgba(255,255,255,0.18)' },
            ]}
          />
        ))}
      </Animated.View>

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Pressable
            key={d}
            onPress={() => press(d)}
            accessibilityRole="button"
            accessibilityLabel={`Chiffre ${d}`}
            style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={styles.keyText}>{d}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={authenticate}
          accessibilityRole="button"
          accessibilityLabel={`Déverrouiller avec ${biometricLabel}`}
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name={biometricLabel === 'Face ID' ? 'user-check' : 'unlock'} size={22} color={colors.gold} />
        </Pressable>
        <Pressable
          onPress={() => press('0')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={styles.keyText}>0</Text>
        </Pressable>
        <Pressable
          onPress={() => setPin(pin.slice(0, -1))}
          accessibilityRole="button"
          accessibilityLabel="Effacer"
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name="delete" size={20} color={colors.onForest} />
        </Pressable>
      </View>

      <Text style={styles.footer}>Code de démonstration : 1234 · ou touchez {biometricLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 40,
    paddingBottom: 30,
  },
  brand: { alignItems: 'center' },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  brandName: { color: '#fff', fontSize: 17, fontWeight: '600', fontFamily: fonts.display },
  brandHint: { color: colors.onForest, fontSize: 12, marginTop: 5, fontFamily: fonts.body },
  dots: { flexDirection: 'row', gap: 14 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 264,
    justifyContent: 'space-between',
    rowGap: 8,
  },
  key: { width: 80, height: 58, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#fff', fontSize: 24, fontFamily: fonts.mono },
  footer: { color: '#8FB09D', fontSize: 10, fontFamily: fonts.body },
});
