import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, ScreenHeader, PrimaryButton } from '../components/UI';
import { OPERATORS, requestDeposit, requestWithdrawal } from '../api/mobileMoneyApi';
import { useAuth } from '../auth/AuthContext';

export default function MobileMoneyScreen() {
  const { knownPhone } = useAuth();
  const [direction, setDirection] = useState('in');
  const [operator, setOperator] = useState(OPERATORS[0]);
  const [amount, setAmount] = useState('');
  // Pour un dépôt, c'est en général le propre numéro du client qui
  // reçoit la demande USSD Airtel/Moov — préremplipar défaut, mais
  // modifiable (il peut vouloir créditer depuis un autre portefeuille).
  // Pour un envoi, c'est le compte de l'entreprise CPG qui envoie
  // l'argent vers le numéro que le client précise ici.
  const [phone, setPhone] = useState(knownPhone ?? '');
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');

  const reset = () => {
    setStatus('idle');
    setReceipt(null);
    setAmount('');
    setError('');
  };

  const submit = async () => {
    setStatus('loading');
    setError('');
    try {
      const payload = { operator: operator.id, amount: Number(amount), phone: phone.trim() };
      const result =
        direction === 'in' ? await requestDeposit(payload) : await requestWithdrawal(payload);
      setReceipt(result);
      setStatus('done');
    } catch (e) {
      setError(e.message ?? "L'opération n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.");
      setStatus('error');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader title="Mobile Money" subtitle="Transferts vers et depuis votre compte CPG" />

      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {[
            { key: 'in', label: 'Recevoir', icon: 'arrow-down-left' },
            { key: 'out', label: 'Envoyer', icon: 'arrow-up-right' },
          ].map((d) => {
            const active = direction === d.key;
            return (
              <Pressable
                key={d.key}
                onPress={() => {
                  setDirection(d.key);
                  setPhone(d.key === 'in' ? (knownPhone ?? '') : '');
                  reset();
                }}
                style={[
                  styles.dirBtn,
                  { backgroundColor: active ? colors.forest : colors.card, borderColor: active ? colors.forest : colors.line },
                ]}
              >
                <Feather name={d.icon} size={14} color={active ? '#fff' : colors.muted} />
                <Text style={[styles.dirText, { color: active ? '#fff' : colors.muted }]}>
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Card style={{ padding: 18 }}>
          {status === 'done' ? (
            <View style={{ alignItems: 'center', paddingVertical: 18 }}>
              <View style={styles.successIcon}>
                <Feather name="check" size={26} color={colors.forestLight} />
              </View>
              <Text style={styles.cardTitle}>
                {direction === 'in' ? 'Dépôt initié' : 'Envoi initié'}
              </Text>
              <Text style={styles.hint}>
                {formatFCFA(receipt.amount)} FCFA via {operator.label}
              </Text>
              <Text style={[styles.hint, { fontFamily: fonts.mono, marginTop: 4 }]}>
                Réf. {receipt.reference}
              </Text>
              <Text style={[styles.hint, { marginTop: 10 }]}>
                Confirmez l'opération sur votre téléphone {operator.label}.
              </Text>
              <PrimaryButton label="Nouvelle opération" onPress={reset} style={{ marginTop: 18, alignSelf: 'stretch' }} />
            </View>
          ) : (
            <>
              <Text style={styles.inputLabel}>Opérateur</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {OPERATORS.map((op) => {
                  const active = operator.id === op.id;
                  return (
                    <Pressable
                      key={op.id}
                      onPress={() => setOperator(op)}
                      style={[
                        styles.opBtn,
                        {
                          backgroundColor: active ? colors.forestPale : colors.card,
                          borderColor: active ? colors.forestLight : colors.line,
                        },
                      ]}
                    >
                      <Text style={[styles.opText, { color: active ? colors.forestLight : colors.muted }]}>
                        {op.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>
                {direction === 'in' ? 'Numéro qui envoie le dépôt' : 'Numéro du destinataire'}
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+241 06 00 00 01"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
              />

              <Text style={styles.inputLabel}>Montant (FCFA)</Text>
              <TextInput
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                style={styles.input}
              />

              {!!error && <Text style={styles.error}>{error}</Text>}

              {status === 'loading' ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.forest} />
                </View>
              ) : (
                <PrimaryButton
                  label={direction === 'in' ? 'Confirmer le dépôt' : "Confirmer l'envoi"}
                  disabled={!amount || Number(amount) <= 0 || phone.trim().length < 8}
                  onPress={submit}
                />
              )}

              <Text style={styles.hint}>
                {direction === 'in'
                  ? `Vous recevrez une demande de confirmation ${operator.label} sur ce numéro.`
                  : `Le destinataire recevra les fonds sur son compte ${operator.label}.`}
              </Text>
            </>
          )}
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  dirBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  dirText: { fontSize: 12, fontWeight: '600', fontFamily: fonts.body },
  opBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center' },
  opText: { fontSize: 12, fontWeight: '500', fontFamily: fonts.body },
  inputLabel: { fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    color: colors.ink,
    fontFamily: fonts.mono,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily: fonts.body },
  hint: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 10, fontFamily: fonts.body },
  error: { fontSize: 11, color: colors.danger, marginBottom: 10, fontFamily: fonts.body },
  loading: { paddingVertical: 14, alignItems: 'center' },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.forestPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
});

