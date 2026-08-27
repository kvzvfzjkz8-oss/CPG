import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, Pill, ScreenHeader } from '../components/UI';
import RailProgress from '../components/RailProgress';
import { account, activeLoan, transactions } from '../data/mockData';

export default function DashboardScreen({ navigation }) {
  const monthsLeft = activeLoan.totalMonths - activeLoan.paidMonths;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader
        title={`Bonjour, ${account.holder.split(' ')[0]}`}
        subtitle={account.job}
        right={
          <Pressable onPress={() => navigation.navigate('Profil')} accessibilityLabel="Notifications">
            <Feather name="bell" size={20} color={colors.ink} />
            <View style={styles.badgeDot} />
          </Pressable>
        }
      />

      {/* Solde */}
      <View style={{ paddingHorizontal: 20 }}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde du compte principal</Text>
          <Text style={styles.balanceValue}>
            {formatFCFA(account.balance)} <Text style={styles.balanceCurrency}>FCFA</Text>
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
      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <Card style={{ padding: 16 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Crédit en cours</Text>
            <Pill tone="gold">{monthsLeft} mois restants</Pill>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
            <Text style={styles.loanAmount}>{formatFCFA(activeLoan.remaining)}</Text>
            <Text style={styles.loanMeta}>
              FCFA restants sur {formatFCFA(activeLoan.initialAmount)}
            </Text>
          </View>
          <RailProgress total={activeLoan.totalMonths} paid={activeLoan.paidMonths} compact />
          <View style={styles.rowBetween}>
            <Text style={styles.loanMeta}>
              Mensualité : {formatFCFA(activeLoan.monthlyPayment)} FCFA
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

      {/* Transactions */}
      <View style={[styles.rowBetween, { paddingHorizontal: 20, marginTop: 22, marginBottom: 8 }]}>
        <Text style={styles.sectionTitle}>Transactions récentes</Text>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 8 }}>
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
                  <Text style={styles.txDate}>{t.date}</Text>
                </View>
              </View>
              <Text
                style={[
                  styles.txAmount,
                  { color: incoming ? colors.forestLight : colors.danger },
                ]}
              >
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
