import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { colors, fonts } from '../theme';
import { useAuth, ApiError } from '../auth/AuthContext';
import { checkActivationNeeded } from '../api/clientApi';

/**
 * Quatre étapes possibles :
 *   - 'phone'           : numéro de téléphone (première fois sur cet appareil)
 *   - 'pin'              : code PIN, pour une connexion normale
 *   - 'activate-number'  : le compte n'a pas encore de PIN (première
 *                          activation, ou après une réinitialisation
 *                          par le gestionnaire) — demande le numéro
 *                          client CPG, qui prouve l'identité
 *   - 'activate-pin'     : le client choisit lui-même son propre code
 *
 * « Chaque client puisse se connecter avec leur numéro et un mot de
 *   passe qu'ils vont créer par eux-mêmes. » — c'est le passage par
 * 'activate-number' → 'activate-pin' qui réalise ça : le serveur ne
 * laisse passer que si le numéro client correspond, jamais le
 * gestionnaire ne choisit le code à la place du client.
 */
export default function LockScreen() {
  const { login, activate, knownPhone } = useAuth();
  const [phone, setPhone] = useState(knownPhone ?? '');
  const [step, setStep] = useState(knownPhone ? 'pin' : 'phone');
  const [compteConnu, setCompteConnu] = useState(Boolean(knownPhone));
  const [pin, setPin] = useState('');
  const [clientNumber, setClientNumber] = useState('');
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

  const confirmPhone = useCallback(async () => {
    if (phone.trim().length < 8) return;
    setBusy(true);
    setError('');
    try {
      const activationRequise = await checkActivationNeeded(phone);
      setCompteConnu(!activationRequise);
      setStep(activationRequise ? 'activate-number' : 'pin');
    } catch {
      // Vérification indisponible (réseau, etc.) : on ne bloque pas
      // pour autant, l'écran PIN classique reste un repli valable
      // puisque la connexion elle-même redirige déjà vers
      // l'activation si besoin.
      setStep('pin');
    } finally {
      setBusy(false);
    }
  }, [phone]);

  const attemptLogin = useCallback(async (enteredPin) => {
    setBusy(true);
    setError('');
    try {
      await login(phone, enteredPin);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pin_non_defini') {
        // Pas un échec de saisie : ce compte attend simplement sa
        // première activation (ou vient d'être réinitialisé).
        setPin('');
        setStep('activate-number');
        setError('');
      } else {
        fail(e.message ?? 'Code PIN incorrect.');
      }
    } finally {
      setBusy(false);
    }
  }, [phone, login, fail]);

  const attemptActivation = useCallback(async (newPin) => {
    setBusy(true);
    setError('');
    try {
      await activate(phone, clientNumber.trim().toUpperCase(), newPin);
    } catch (e) {
      fail(e.message ?? 'Activation impossible.');
      setStep('activate-pin');
    } finally {
      setBusy(false);
    }
  }, [phone, clientNumber, activate, fail]);

  const pressDigit = (digit) => {
    if (busy || pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        if (step === 'activate-pin') attemptActivation(next);
        else attemptLogin(next);
      }, 120);
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
          onPress={confirmPhone}
          disabled={busy}
          style={({ pressed }) => [styles.continueBtn, { opacity: pressed || busy ? 0.7 : 1 }]}
        >
          {busy ? <ActivityIndicator color={colors.forest} /> : <Text style={styles.continueText}>Continuer</Text>}
        </Pressable>


        <View style={{ height: 40 }} />
      </View>
    );
  }

  if (step === 'activate-number') {
    return (
      <View style={styles.root}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Feather name="user-plus" size={24} color={colors.forest} />
          </View>
          <Text style={styles.brandName}>Première connexion</Text>
          <Text style={styles.brandHint}>
            Entrez votre numéro client CPG (communiqué par votre agence) pour créer votre code PIN.
          </Text>
        </View>

        <TextInput
          style={styles.phoneInput}
          placeholder="CPG-00931"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoCapitalize="characters"
          autoFocus
          value={clientNumber}
          onChangeText={setClientNumber}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => clientNumber.trim().length >= 3 && setStep('activate-pin')}
          style={({ pressed }) => [styles.continueBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.continueText}>Continuer</Text>
        </Pressable>

        <Pressable onPress={() => { setStep('phone'); setError(''); }}>
          <Text style={styles.changePhone}>Modifier le numéro de téléphone</Text>
        </Pressable>

        <View style={{ height: 20 }} />
      </View>
    );
  }

  const isActivating = step === 'activate-pin';

  return (
    <View style={styles.root}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Feather name={isActivating ? 'user-plus' : 'git-commit'} size={24} color={colors.forest} />
        </View>
        <Text style={styles.brandName}>Crédit Populaire du Gabon</Text>
        <Text style={styles.brandHint}>
          {isActivating ? 'Choisissez votre code PIN' : compteConnu ? `Code PIN pour ${phone}` : 'Entrez votre code PIN'}
        </Text>
        {!isActivating && (
          <Pressable onPress={() => { setPin(''); setError(''); setStep('phone'); }}>
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
        {isActivating ? (
          <View style={styles.key} />
        ) : (
          <Pressable
            onPress={authenticateBiometric}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Déverrouiller avec ${biometricLabel}`}
            style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name={biometricLabel === 'Face ID' ? 'user-check' : 'unlock'} size={22} color={colors.gold} />
          </Pressable>
        )}
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
  brandHint: {
    color: colors.onForest, fontSize: 12, marginTop: 5, fontFamily: fonts.body,
    textAlign: 'center', paddingHorizontal: 12,
  },
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
