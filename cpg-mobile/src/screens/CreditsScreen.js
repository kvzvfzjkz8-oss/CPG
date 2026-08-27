import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, ScreenHeader, PrimaryButton, SegmentedControl } from '../components/UI';
import RailProgress from '../components/RailProgress';
import { fetchProducts, fetchCredits, simulateCredit, requestCredit } from '../api/clientApi';

export default function CreditsScreen() {
  const [tab, setTab] = useState('suivi');
  const [products, setProducts] = useState([]);
  // Portées d'un onglet à l'autre : simuler un montant puis passer à
  // "Demande" doit repartir des mêmes valeurs, pas d'un formulaire vide.
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [amount, setAmount] = useState(300000);
  const [months, setMonths] = useState(12);

  useEffect(() => {
    fetchProducts()
      .then((res) => {
        setProducts(res.produits);
        if (res.produits.length > 0) setSelectedProductId(res.produits[0].id);
      })
      .catch(() => {});
  }, []);

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
        {tab === 'simulation' && (
          <Simulator
            products={products}
            selectedProductId={selectedProductId}
            onSelectProduct={setSelectedProductId}
            amount={amount}
            onAmount={setAmount}
            months={months}
            onMonths={setMonths}
            onApply={() => setTab('demande')}
          />
        )}
        {tab === 'demande' && (
          <LoanRequest
            produitId={selectedProductId}
            produit={products.find((p) => p.id === selectedProductId)}
            montant={amount}
            duree={months}
          />
        )}
      </View>
    </ScrollView>
  );
}

function LoanTracking() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCredit, setActiveCredit] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchCredits();
      setActiveCredit(res.activeCredit);
    } catch (e) {
      setError(e.message ?? 'Impossible de charger vos crédits.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <ActivityIndicator color={colors.forest} style={{ marginTop: 40 }} />;
  }
  if (error) {
    return (
      <Card style={{ padding: 18 }}>
        <Text style={styles.disclaimer}>{error}</Text>
      </Card>
    );
  }
  if (!activeCredit) {
    return (
      <Card style={{ padding: 18, alignItems: 'center', paddingVertical: 34 }}>
        <Feather name="inbox" size={26} color={colors.muted} />
        <Text style={[styles.cardTitle, { marginTop: 10 }]}>Aucun crédit actif</Text>
        <Text style={styles.disclaimer}>Utilisez l'onglet Simulation pour préparer une demande.</Text>
      </Card>
    );
  }

  const monthsLeft = activeCredit.installments.filter((i) => i.status !== 'payee').length;
  const nextDue = activeCredit.installments.find((i) => i.status === 'a_venir');
  const facts = [
    ['Montant initial', `${formatFCFA(activeCredit.amount)} F`],
    ['Reste à payer', `${formatFCFA(activeCredit.remainingAmount)} F`],
    ['Mensualité', `${formatFCFA(activeCredit.monthly_payment)} F`],
    ['Mois restants', `${monthsLeft} / ${activeCredit.duration_months}`],
  ];

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="credit-card" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Microcrédit · Réf. {activeCredit.reference}</Text>
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
      <RailProgress total={activeCredit.duration_months} paid={activeCredit.paidMonths} />

      {nextDue && (
        <View style={styles.notice}>
          <Feather name="shield" size={15} color={colors.forestLight} />
          <Text style={styles.noticeText}>
            Prochaine échéance le {new Date(nextDue.due_date).toLocaleDateString('fr-FR')} — prélèvement automatique.
          </Text>
        </View>
      )}
    </Card>
  );
}

function Simulator({ products, selectedProductId, onSelectProduct, amount, onAmount, months, onMonths, onApply }) {
  const product = products.find((p) => p.id === selectedProductId);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const bounds = product
    ? {
        minAmount: product.montantMin, maxAmount: product.montantMax,
        minDuration: product.dureeMin, maxDuration: product.dureeMax,
      }
    : { minAmount: 50000, maxAmount: 2000000, minDuration: 3, maxDuration: 36 };

  const runSimulation = async () => {
    if (!selectedProductId) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await simulateCredit({ produitId: selectedProductId, montant: amount, duree: months });
      setResult(res);
    } catch (e) {
      setError(e.message ?? 'Simulation impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) {
    return <ActivityIndicator color={colors.forest} style={{ marginTop: 40 }} />;
  }

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="sliders" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Simuler un prêt</Text>
      </View>

      <Text style={styles.inputLabel}>Type de crédit</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {products.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => onSelectProduct(p.id)}
            style={[styles.productChip, selectedProductId === p.id && styles.productChipActive]}
          >
            <Text style={[styles.productChipText, selectedProductId === p.id && styles.productChipTextActive]}>
              {p.nom}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sliderLabel}>
        Montant souhaité : <Text style={styles.sliderValue}>{formatFCFA(amount)} FCFA</Text>
      </Text>
      <Slider
        minimumValue={bounds.minAmount}
        maximumValue={bounds.maxAmount}
        step={10000}
        value={amount}
        onValueChange={onAmount}
        minimumTrackTintColor={colors.forest}
        maximumTrackTintColor={colors.line}
        thumbTintColor={colors.forest}
        style={{ marginBottom: 14 }}
      />

      <Text style={styles.sliderLabel}>
        Durée : <Text style={styles.sliderValue}>{months} mois</Text>
      </Text>
      <Slider
        minimumValue={bounds.minDuration}
        maximumValue={bounds.maxDuration}
        step={1}
        value={months}
        onValueChange={onMonths}
        minimumTrackTintColor={colors.forest}
        maximumTrackTintColor={colors.line}
        thumbTintColor={colors.forest}
        style={{ marginBottom: 18 }}
      />

      <Pressable onPress={runSimulation} style={styles.simulateBtn} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.forest} /> : <Text style={styles.simulateBtnText}>Calculer la mensualité</Text>}
      </Pressable>

      {error ? <Text style={[styles.disclaimer, { color: colors.danger }]}>{error}</Text> : null}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Mensualité estimée</Text>
          <Text style={styles.resultValue}>
            {formatFCFA(result.monthlyPayment)} <Text style={{ fontSize: 14 }}>FCFA / mois</Text>
          </Text>
          <Text style={[styles.disclaimer, { color: colors.onForest, marginTop: 8 }]}>{result.avertissement}</Text>
        </View>
      )}

      <PrimaryButton
        label="Faire une demande avec ce montant"
        onPress={onApply}
        disabled={!selectedProductId}
        style={{ marginTop: 14 }}
      />
    </Card>
  );
}

function LoanRequest({ produitId, produit, montant, duree }) {
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!produitId) return;
    setBusy(true);
    setError('');
    try {
      await requestCredit({ produitId, montant, duree, motif: reason.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(e.message ?? "L'envoi a échoué.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Card style={{ padding: 18, alignItems: 'center', paddingVertical: 34 }}>
        <View style={styles.successIcon}>
          <Feather name="check" size={26} color={colors.forestLight} />
        </View>
        <Text style={styles.cardTitle}>Demande envoyée</Text>
        <Text style={[styles.disclaimer, { marginTop: 6 }]}>
          Votre dossier de {formatFCFA(montant)} FCFA est en cours de vérification.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18 }}>
      <View style={styles.rowIcon}>
        <Feather name="file-text" size={16} color={colors.forestLight} />
        <Text style={styles.cardTitle}>Demande de crédit{produit ? ` — ${produit.nom}` : ''}</Text>
      </View>

      <Text style={styles.inputLabel}>Montant demandé</Text>
      <Text style={[styles.factValue, { marginBottom: 14 }]}>{formatFCFA(montant)} FCFA sur {duree} mois</Text>
      <Text style={[styles.disclaimer, { textAlign: 'left', marginBottom: 14 }]}>
        Réglez le montant et la durée depuis l'onglet Simulation avant d'envoyer.
      </Text>

      <Text style={styles.inputLabel}>Motif du prêt (optionnel)</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Ex. équipement, imprévu familial, projet personnel…"
        placeholderTextColor={colors.muted}
        multiline
        numberOfLines={3}
        style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
      />

      {error ? <Text style={[styles.disclaimer, { color: colors.danger, textAlign: 'left' }]}>{error}</Text> : null}

      <PrimaryButton
        label={busy ? 'Envoi…' : 'Envoyer la demande'}
        disabled={!produitId || busy}
        onPress={submit}
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
  productChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1, borderColor: colors.line,
  },
  productChipActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  productChipText: { fontSize: 11, color: colors.muted, fontFamily: fonts.body },
  productChipTextActive: { color: '#fff', fontWeight: '600' },
  simulateBtn: {
    backgroundColor: colors.forestPale, borderRadius: radius.md, paddingVertical: 12,
    alignItems: 'center', marginBottom: 12,
  },
  simulateBtnText: { color: colors.forestLight, fontSize: 12, fontWeight: '600', fontFamily: fonts.body },
  resultBox: { backgroundColor: colors.forest, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 4 },
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
