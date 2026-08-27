import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Alert, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, formatFCFA } from '../theme';
import { Card, ScreenHeader } from '../components/UI';
import { account, activeLoan, notifications } from '../data/mockData';
import {
  sendTestNotification,
  scheduleRepaymentReminder,
  cancelAllScheduled,
} from '../notifications/pushNotifications';

const SECURITY_ITEMS = ['Code PIN', 'Face ID / Empreinte digitale', 'Historique des connexions'];

export default function ProfileScreen() {
  const [transactionAlerts, setTransactionAlerts] = useState(true);
  const [dueDateAlerts, setDueDateAlerts] = useState(true);

  const toggleDueDates = async (value) => {
    setDueDateAlerts(value);
    if (value) {
      // Démonstration : rappel programmé 3 jours avant la prochaine échéance.
      const next = new Date();
      next.setDate(next.getDate() + 8);
      const id = await scheduleRepaymentReminder({
        dueDate: next,
        amount: formatFCFA(activeLoan.monthlyPayment),
      });
      if (!id) {
        Alert.alert('Rappel non programmé', 'La date d’échéance est déjà passée.');
      }
    } else {
      await cancelAllScheduled();
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader title="Profil" subtitle={`${account.holder} · ${account.job}`} />

      <View style={{ paddingHorizontal: 20 }}>
        <Card style={styles.identity}>
          <View style={styles.avatar}>
            <Feather name="user" size={20} color={colors.forestLight} />
          </View>
          <View>
            <Text style={styles.name}>{account.holder}</Text>
            <Text style={styles.meta}>
              Client depuis {account.memberSince} · N° {account.clientNumber}
            </Text>
          </View>
        </Card>

        <View style={styles.sectionRow}>
          <Feather name="bell" size={14} color={colors.ink} />
          <Text style={styles.sectionTitle}>Notifications</Text>
        </View>
        <View style={{ gap: 8, marginBottom: 20 }}>
          {notifications.map((n) => (
            <Card key={n.id} style={styles.notif}>
              <View style={styles.notifIcon}>
                <Feather name={n.icon} size={14} color={colors.forestLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifTitle}>{n.title}</Text>
                <Text style={styles.notifBody}>{n.body}</Text>
              </View>
            </Card>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Feather name="settings" size={14} color={colors.ink} />
          <Text style={styles.sectionTitle}>Préférences d'alertes</Text>
        </View>
        <Card style={{ marginBottom: 20 }}>
          <View style={[styles.settingRow, styles.divider]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.settingText}>Alertes de transaction</Text>
              <Text style={styles.settingHint}>Dépôts, retraits, paiements</Text>
            </View>
            <Switch
              value={transactionAlerts}
              onValueChange={setTransactionAlerts}
              trackColor={{ true: colors.forestLight, false: colors.line }}
              thumbColor="#fff"
            />
          </View>
          <View style={[styles.settingRow, styles.divider]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.settingText}>Rappels d'échéance</Text>
              <Text style={styles.settingHint}>3 jours avant chaque prélèvement</Text>
            </View>
            <Switch
              value={dueDateAlerts}
              onValueChange={toggleDueDates}
              trackColor={{ true: colors.forestLight, false: colors.line }}
              thumbColor="#fff"
            />
          </View>
          <Pressable style={styles.settingRow} onPress={sendTestNotification}>
            <Text style={[styles.settingText, { color: colors.forestLight }]}>
              Envoyer une notification de test
            </Text>
            <Feather name="send" size={14} color={colors.forestLight} />
          </Pressable>
        </Card>

        <View style={styles.sectionRow}>
          <Feather name="shield" size={14} color={colors.ink} />
          <Text style={styles.sectionTitle}>Sécurité</Text>
        </View>
        <Card>
          {SECURITY_ITEMS.map((item, i) => (
            <Pressable
              key={item}
              style={[
                styles.settingRow,
                i < SECURITY_ITEMS.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                },
              ]}
            >
              <Text style={styles.settingText}>{item}</Text>
              <Feather name="chevron-right" size={15} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  identity: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.forestPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily: fonts.body },
  meta: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: fonts.body },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily: fonts.body },
  notif: { padding: 12, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  notifIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.forestPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifTitle: { fontSize: 12, fontWeight: '500', color: colors.ink, fontFamily: fonts.body },
  notifBody: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: fonts.body },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  settingText: { fontSize: 12, color: colors.ink, fontFamily: fonts.body },
  settingHint: { fontSize: 10, color: colors.muted, marginTop: 2, fontFamily: fonts.body },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
});
