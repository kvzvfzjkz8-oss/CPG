import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, ScreenHeader, PrimaryButton, SegmentedControl } from '../components/UI';
import RailProgress from '../components/RailProgress';
import { activeLoan, MONTHLY_RATE } from '../data/mockData';

export default function CreditsScreen() {
  const [tab, setTab] = useState('suivi');

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader title="Mes crédits" subtitle="Simulation, demande et suivi" />
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { key: 'suivi', label: 'Suivi' },
          { key: 'simulation', label: 'Simulation' },
          { key: 'demande', label: 'Demande' },
        ]}
      />
      <View style={{ paddingHorizontal: 20 }}>
        {tab === 'suivi' && <LoanTracking />}
        {tab === 'simulation' && <Simulator onApply={() => setTab('demande')} />}
        {tab === 'demande' && <LoanRequest />}
      </View>
    </ScrollView>
  );
}

function LoanTracking() {
  const monthsLeft = activeLoan.totalMonths - activeLoan.paidMonths;
  const facts = [
    ['Montant initial', `${formatFCFA(activeLoan.initialAmount)} F`],
    ['Reste à payer', `${formatFCFA(activeLoan.remaining)} F`],
    ['Mensualité', `${formatFCFA(activeLoan.monthlyPayment)} F`],
    ['Mois restants', `${monthsLeft} / ${activeLoan.totalMonths}`],
  ];

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="credit-card" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Microcrédit personnel · Réf. {activeLoan.ref}</Text>
      </View>

      <View style={styles.factGrid}>
        {facts.map(([k, v]) => (
          <View key={k} style={{ width: '48%', marginBottom: 12 }}>
            <Text style={styles.factLabel}>{k}</Text>
            <Text style={styles.factValue}>{v}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.factLabel}>Échéancier</Text>
      <RailProgress total={activeLoan.totalMonths} paid={activeLoan.paidMonths} />

      <View style={styles.notice}>
        <Feather name="shield" size={15} color={colors.forestLight} />
        <Text style={styles.noticeText}>
          Prochaine échéance le {activeLoan.nextDueDate} — prélèvement via Mobile Money.
        </Text>
      </View>
    </Card>
  );
}

function Simulator({ onApply }) {
  const [amount, setAmount] = useState(500000);
  const [months, setMonths] = useState(12);

  const monthly = useMemo(
    () => Math.round((amount * (1 + MONTHLY_RATE * months)) / months),
    [amount, months]
  );

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="sliders" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Simuler un prêt</Text>
      </View>

      <Text style={styles.sliderLabel}>
        Montant souhaité : <Text style={styles.sliderValue}>{formatFCFA(amount)} FCFA</Text>
      </Text>
      <Slider
        minimumValue={50000}
        maximumValue={2000000}
        step={10000}
        value={amount}
        onValueChange={setAmount}
        minimumTrackTintColor={colors.forest}
        maximumTrackTintColor={colors.line}
        thumbTintColor={colors.forest}
        style={{ marginBottom: 14 }}
      />

      <Text style={styles.sliderLabel}>
        Durée : <Text style={styles.sliderValue}>{months} mois</Text>
      </Text>
      <Slider
        minimumValue={3}
        maximumValue={36}
        step={1}
        value={months}
        onValueChange={setMonths}
        minimumTrackTintColor={colors.forest}
        maximumTrackTintColor={colors.line}
        thumbTintColor={colors.forest}
        style={{ marginBottom: 18 }}
      />

      <View style={styles.resultBox}>
        <Text style={styles.resultLabel}>Mensualité estimée</Text>
        <Text style={styles.resultValue}>
          {formatFCFA(monthly)} <Text style={{ fontSize: 14 }}>FCFA / mois</Text>
        </Text>
      </View>
      <Text style={styles.disclaimer}>
        Simulation indicative, taux {(MONTHLY_RATE * 100).toString().replace('.', ',')} %/mois.
        Sous réserve d'étude du dossier.
      </Text>
      <PrimaryButton
        label="Faire une demande avec ce montant"
        onPress={onApply}
        style={{ marginTop: 14 }}
      />
    </Card>
  );
}

function LoanRequest() {
  const [amount, setAmount] = useState('300000');
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Card style={{ padding: 18, alignItems: 'center', paddingVertical: 34 }}>
        <View style={styles.successIcon}>
          <Feather name="check" size={26} color={colors.forestLight} />
        </View>
        <Text style={styles.cardTitle}>Demande envoyée</Text>
        <Text style={[styles.disclaimer, { marginTop: 6 }]}>
          Un conseiller CPG examinera votre dossier de {formatFCFA(amount)} FCFA sous 48 h.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="file-text" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Demande de microcrédit</Text>
      </View>

      <Text style={styles.inputLabel}>Montant demandé (FCFA)</Text>
      <TextInput
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        style={[styles.input, { fontFamily: fonts.mono }]}
      />

      <Text style={styles.inputLabel}>Motif du prêt</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Ex. équipement, imprévu familial, projet personnel…"
        placeholderTextColor={colors.muted}
        multiline
        numberOfLines={3}
        style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
      />

      <Pressable style={styles.attach}>
        <Feather name="paperclip" size={14} color={colors.muted} />
        <Text style={styles.attachText}>Joindre une pièce justificative</Text>
      </Pressable>

      <PrimaryButton
        label="Envoyer la demande"
        disabled={!amount}
        onPress={() => setSent(true)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  rowIcon: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily: fonts.body, flex: 1 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  factLabel: { fontSize: 10, color: colors.muted, fontFamily: fonts.body },
  factValue: { fontSize: 14, color: colors.ink, fontFamily: fonts.mono, marginTop: 2 },
  notice: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.forestPale,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 14,
  },
  noticeText: { flex: 1, fontSize: 11, color: colors.forestLight, fontFamily: fonts.body },
  sliderLabel: { fontSize: 11, color: colors.muted, fontFamily: fonts.body },
  sliderValue: { color: colors.ink, fontWeight: '600' },
  resultBox: { backgroundColor: colors.forest, borderRadius: radius.md, padding: 16, alignItems: 'center' },
  resultLabel: { fontSize: 11, color: colors.onForest, fontFamily: fonts.body },
  resultValue: { fontSize: 24, color: '#fff', fontFamily: fonts.mono, marginTop: 4 },
  disclaimer: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 8, fontFamily: fonts.body },
  inputLabel: { fontSize: 11, color: colors.muted, fontFamily: fonts.body, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    fontFamily: fonts.body,
    marginBottom: 14,
  },
  attach: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 11,
    marginBottom: 16,
  },
  attachText: { fontSize: 12, color: colors.muted, fontFamily: fonts.body },
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
