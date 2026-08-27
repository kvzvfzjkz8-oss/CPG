import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, Pill, ScreenHeader } from '../components/UI';
import RailProgress from '../components/RailProgress';
import { useAuth } from '../auth/AuthContext';
import { fetchAccount, fetchCredits, fetchTransactions } from '../api/clientApi';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function DashboardScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState(null);
  const [activeCredit, setActiveCredit] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [accountRes, creditsRes, txRes] = await Promise.all([
        fetchAccount(),
        fetchCredits(),
        fetchTransactions({ limite: 6 }),
      ]);
      setAccount(accountRes);
      setActiveCredit(creditsRes.activeCredit);
      setTransactions(txRes.transactions);
    } catch (e) {
      setError(e.message ?? 'Impossible de charger votre compte.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.forest} size="large" />
      </View>
    );
  }

  const firstName = (user?.fullName ?? '').split(' ')[0] || 'Client';
  const monthsLeft = activeCredit
    ? activeCredit.installments.filter((i) => i.status !== 'payee').length
    : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
    >
      <ScreenHeader
        title={`Bonjour, ${firstName}`}
        subtitle={user?.clientNumber}
        right={
          <Pressable onPress={() => navigation.navigate('Profil')} accessibilityLabel="Notifications">
            <Feather name="bell" size={20} color={colors.ink} />
            <View style={styles.badgeDot} />
          </Pressable>
        }
      />

      {error ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        </View>
      ) : null}

      {/* Solde */}
      <View style={{ paddingHorizontal: 20 }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde du compte principal</Text>
          <Text style={styles.balanceValue}>
            {formatFCFA(account?.account?.balance ?? 0)} <Text style={styles.balanceCurrency}>FCFA</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
            <Pressable
              onPress={() => navigation.navigate('Mobile Money')}
              style={[styles.balanceBtn, { backgroundColor: colors.gold }]}
            >
              <Feather name="arrow-down-left" size={14} color={colors.forest} />
              <Text style={[styles.balanceBtnText, { color: colors.forest }]}>Recevoir</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Mobile Money')}
              style={[styles.balanceBtn, { backgroundColor: 'rgba(255,255,255,0.12)' }]}
            >
              <Feather name="arrow-up-right" size={14} color="#fff" />
              <Text style={[styles.balanceBtnText, { color: '#fff' }]}>Envoyer</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Crédit en cours */}
      {activeCredit ? (
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <Card style={{ padding: 16 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Crédit en cours</Text>
              <Pill tone="gold">{monthsLeft} mois restants</Pill>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <Text style={styles.loanAmount}>{formatFCFA(activeCredit.remainingAmount)}</Text>
              <Text style={styles.loanMeta}>FCFA restants sur {formatFCFA(activeCredit.amount)}</Text>
            </View>
            <RailProgress total={activeCredit.duration_months} paid={activeCredit.paidMonths} compact />
            <View style={styles.rowBetween}>
              <Text style={styles.loanMeta}>
                Mensualité : {formatFCFA(activeCredit.monthly_payment)} FCFA
              </Text>
              <Pressable
                onPress={() => navigation.navigate('Crédits')}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <Text style={styles.link}>Détails</Text>
                <Feather name="chevron-right" size={13} color={colors.forestLight} />
              </Pressable>
            </View>
          </Card>
        </View>
      ) : null}

      {/* Transactions */}
      <View style={[styles.rowBetween, { paddingHorizontal: 20, marginTop: 22, marginBottom: 8 }]}>
        <Text style={styles.sectionTitle}>Transactions récentes</Text>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 8 }}>
        {transactions.length === 0 && (
          <Text style={styles.loanMeta}>Aucune transaction pour le moment.</Text>
        )}
        {transactions.map((t) => {
          const incoming = t.amount > 0;
          return (
            <Card key={t.id} style={styles.txRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <View
                  style={[
                    styles.txIcon,
                    { backgroundColor: incoming ? colors.forestPale : colors.dangerPale },
                  ]}
                >
                  <Feather
                    name={incoming ? 'arrow-down-left' : 'arrow-up-right'}
                    size={15}
                    color={incoming ? colors.forestLight : colors.danger}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txLabel} numberOfLines={1}>
                    {t.label}
                  </Text>
                  <Text style={styles.txDate}>{formatDate(t.created_at)}</Text>
                </View>
              </View>
              <Text style={[styles.txAmount, { color: incoming ? colors.forestLight : colors.danger }]}>
                {incoming ? '+' : '−'}
                {formatFCFA(Math.abs(t.amount))}
              </Text>
            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
  errorCard: { padding: 12, backgroundColor: colors.dangerPale, marginBottom: 10 },
  errorText: { color: colors.danger, fontSize: 12, fontFamily: fonts.body },
  balanceCard: { backgroundColor: colors.forest, borderRadius: radius.xl, padding: 20 },
  balanceLabel: { color: colors.onForest, fontSize: 12, fontFamily: fonts.body },
  balanceValue: { color: '#fff', fontSize: 30, fontFamily: fonts.mono, marginTop: 4 },
  balanceCurrency: { fontSize: 15 },
  balanceBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: radius.md,
  },
  balanceBtnText: { fontSize: 12, fontWeight: '600', fontFamily: fonts.body },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily: fonts.body },
  loanAmount: { fontSize: 20, color: colors.ink, fontFamily: fonts.mono },
  loanMeta: { fontSize: 11, color: colors.muted, fontFamily: fonts.body },
  link: { fontSize: 11, fontWeight: '600', color: colors.forestLight, fontFamily: fonts.body },
  txRow: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  txLabel: { fontSize: 12, fontWeight: '500', color: colors.ink, fontFamily: fonts.body },
  txDate: { fontSize: 10, color: colors.muted, marginTop: 2, fontFamily: fonts.body },
  txAmount: { fontSize: 12, fontWeight: '600', fontFamily: fonts.mono, marginLeft: 8 },
});
