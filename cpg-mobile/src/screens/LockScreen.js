import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { colors, fonts } from '../theme';
import { useAuth } from '../auth/AuthContext';

/**
 * Deux modes selon qu'un numéro de téléphone est déjà enregistré sur
 * l'appareil :
 *   - première connexion : demande le numéro, puis le code PIN, et
 *     authentifie les deux ensemble contre le serveur.
 *   - retour : le numéro est déjà connu, seul le code PIN est demandé
 *     (avec un raccourci biométrique).
 *
 * Contrairement à l'ancienne version, ceci parle réellement au
 * serveur : un mauvais code PIN est refusé par cpg-api, pas comparé à
 * une valeur codée en dur ici.
 */
export default function LockScreen() {
  const { login, knownPhone } = useAuth();
  const [phone, setPhone] = useState(knownPhone ?? '');
  const [step, setStep] = useState(knownPhone ? 'pin' : 'phone');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  const fail = useCallback((message) => {
    setError(message);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setPin(''));
  }, [shake]);

  const attemptLogin = useCallback(async (enteredPin) => {
    setBusy(true);
    setError('');
    try {
      await login(phone, enteredPin);
    } catch (e) {
      fail(e.message ?? 'Code PIN incorrect.');
    } finally {
      setBusy(false);
    }
  }, [phone, login, fail]);

  const pressDigit = (digit) => {
    if (busy || pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => attemptLogin(next), 120);
    }
  };

  const authenticateBiometric = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !enrolled) {
      setError('Utilisez votre code PIN : la biométrie n’est pas configurée sur cet appareil.');
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Déverrouiller votre compte CPG',
      cancelLabel: 'Utiliser le code PIN',
      disableDeviceFallback: false,
    });

    if (!result.success) {
      if (result.error && result.error !== 'user_cancel') {
        setError('Utilisez votre code PIN pour continuer.');
      }
      return;
    }

    if (!knownPhone) {
      setError('Saisissez votre code PIN pour la première connexion sur cet appareil.');
    }
  };

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] });

  if (step === 'phone') {
    return (
      <View style={styles.root}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Feather name="git-commit" size={24} color={colors.forest} />
          </View>
          <Text style={styles.brandName}>Crédit Populaire du Gabon</Text>
          <Text style={styles.brandHint}>Entrez votre numéro de téléphone</Text>
        </View>

        <TextInput
          style={styles.phoneInput}
          placeholder="+241 06 00 00 01"
          placeholderTextColor="rgba(255,255,255,0.4)"
          keyboardType="phone-pad"
          autoFocus
          value={phone}
          onChangeText={setPhone}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => phone.trim().length >= 8 && setStep('pin')}
          style={({ pressed }) => [styles.continueBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.continueText}>Continuer</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Feather name="git-commit" size={24} color={colors.forest} />
        </View>
        <Text style={styles.brandName}>Crédit Populaire du Gabon</Text>
        <Text style={styles.brandHint}>
          {knownPhone ? `Code PIN pour ${phone}` : 'Créez votre code PIN'}
        </Text>
        {!knownPhone && (
          <Pressable onPress={() => setStep('phone')}>
            <Text style={styles.changePhone}>Modifier le numéro</Text>
          </Pressable>
        )}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.gold} size="large" />
      ) : (
        <Animated.View style={[styles.dots, { transform: [{ translateX }] }]}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i < pin.length ? colors.gold : 'rgba(255,255,255,0.18)' }]}
            />
          ))}
        </Animated.View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : <View style={{ height: 18 }} />}

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Pressable
            key={d}
            onPress={() => pressDigit(d)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Chiffre ${d}`}
            style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={styles.keyText}>{d}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={authenticateBiometric}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Déverrouiller avec ${biometricLabel}`}
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name={biometricLabel === 'Face ID' ? 'user-check' : 'unlock'} size={22} color={colors.gold} />
        </Pressable>
        <Pressable
          onPress={() => pressDigit('0')}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={styles.keyText}>0</Text>
        </Pressable>
        <Pressable
          onPress={() => setPin(pin.slice(0, -1))}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Effacer"
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Feather name="delete" size={20} color={colors.onForest} />
        </Pressable>
      </View>
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
  changePhone: { color: colors.gold, fontSize: 11, marginTop: 8, fontFamily: fonts.body, textDecorationLine: 'underline' },
  phoneInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.mono,
    textAlign: 'center',
  },
  continueBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  continueText: { color: colors.forest, fontSize: 15, fontWeight: '600', fontFamily: fonts.body },
  error: { color: '#F4A6A6', fontSize: 12, fontFamily: fonts.body, textAlign: 'center' },
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
});
