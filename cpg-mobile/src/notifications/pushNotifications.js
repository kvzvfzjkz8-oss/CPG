import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { colors } from '../theme';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  NOTIFICATIONS PUSH — cahier des charges §2.4
 * ─────────────────────────────────────────────────────────────────────
 *
 * Deux mécanismes cohabitent :
 *
 * 1. PUSH DISTANTES (serveur → téléphone)
 *    Le backend CPG envoie une alerte quand un événement survient :
 *    transaction Mobile Money confirmée, crédit approuvé, réponse du
 *    conseiller. C'est le cas d'usage principal.
 *
 * 2. RAPPELS LOCAUX (téléphone → téléphone)
 *    Programmés dans l'app, ils fonctionnent hors connexion. Utilisés
 *    pour les échéances de remboursement, dont la date est connue à
 *    l'avance. Un agent de la voie en zone sans réseau reçoit quand
 *    même son rappel.
 *
 * Chaîne d'envoi côté serveur :
 *
 *   Backend CPG ──► API Expo Push ──► APNs (iOS) / FCM (Android) ──► téléphone
 *
 * Le backend a besoin du « push token » de l'appareil, récupéré ici par
 * registerForPushNotifications() et à transmettre à l'API CPG.
 */

/** Comportement quand une notification arrive, app au premier plan. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Demande l'autorisation, configure Android, et retourne le push token.
 * À appeler une fois après la connexion de l'utilisateur.
 *
 * @returns {Promise<string|null>} token Expo, ou null si refusé/indisponible
 */
export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    // Android 8+ exige un canal, sinon rien ne s'affiche.
    await Notifications.setNotificationChannelAsync('cpg-default', {
      name: 'Alertes CPG',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: colors.gold,
    });
    await Notifications.setNotificationChannelAsync('cpg-echeances', {
      name: 'Échéances de crédit',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: colors.gold,
    });
  }

  // Les push distantes ne fonctionnent pas sur simulateur.
  if (!Device.isDevice) {
    console.warn('[push] Appareil physique requis pour les notifications distantes.');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;

  if (existing !== 'granted') {
    const res = await Notifications.requestPermissionsAsync();
    status = res.status;
  }

  if (status !== 'granted') {
    console.warn('[push] Autorisation refusée par l’utilisateur.');
    return null;
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token;
  } catch (e) {
    console.warn('[push] Récupération du token impossible :', e?.message);
    return null;
  }
}

/**
 * Transmet le token au backend CPG pour qu'il puisse cibler cet appareil.
 *
 * @param {string} token
 * @param {string} clientNumber
 */
export async function sendTokenToBackend(token, clientNumber) {
  // TODO: brancher sur le backend CPG
  // await fetch(`${API_BASE_URL}/devices`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  //   body: JSON.stringify({ token, clientNumber, platform: Platform.OS }),
  // });
  console.log('[push] Token à enregistrer côté serveur :', token, clientNumber);
}

/**
 * Programme un rappel local avant une échéance de remboursement.
 * Fonctionne sans connexion réseau.
 *
 * @param {{ dueDate: Date, amount: string, daysBefore?: number }} params
 * @returns {Promise<string|null>} identifiant de la notification programmée
 */
export async function scheduleRepaymentReminder({ dueDate, amount, daysBefore = 3 }) {
  const triggerDate = new Date(dueDate);
  triggerDate.setDate(triggerDate.getDate() - daysBefore);
  triggerDate.setHours(9, 0, 0, 0);

  if (triggerDate <= new Date()) return null; // date déjà passée

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Échéance de crédit à venir',
      body: `Votre mensualité de ${amount} FCFA sera prélevée dans ${daysBefore} jours.`,
      data: { type: 'echeance', screen: 'Crédits' },
      sound: true,
    },
    trigger: { date: triggerDate, channelId: 'cpg-echeances' },
  });
}

/** Notification immédiate — utile pour tester la chaîne sans backend. */
export async function sendTestNotification() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Transaction confirmée',
      body: '120 000 FCFA reçus via Airtel Money.',
      data: { type: 'transaction', screen: 'Accueil' },
    },
    trigger: { seconds: 2, channelId: 'cpg-default' },
  });
}

/** Annule tous les rappels programmés (ex. après solde d'un crédit). */
export async function cancelAllScheduled() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Hook branché dans App.js.
 * Enregistre l'appareil et route les taps sur notification vers le bon écran.
 *
 * @param {{ navigationRef: object, clientNumber: string }} params
 */
export function usePushNotifications({ navigationRef, clientNumber }) {
  const [pushToken, setPushToken] = useState(null);
  const receivedSub = useRef(null);
  const responseSub = useRef(null);

  useEffect(() => {
    let cancelled = false;

    registerForPushNotifications().then((token) => {
      if (cancelled || !token) return;
      setPushToken(token);
      sendTokenToBackend(token, clientNumber);
    });

    // Notification reçue, app ouverte.
    receivedSub.current = Notifications.addNotificationReceivedListener(() => {
      // Place pour rafraîchir le solde ou l'historique.
    });

    // L'utilisateur a touché la notification : on ouvre l'écran concerné.
    responseSub.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = response?.notification?.request?.content?.data?.screen;
      if (screen && navigationRef?.current?.isReady()) {
        navigationRef.current.navigate(screen);
      }
    });

    return () => {
      cancelled = true;
      receivedSub.current?.remove();
      responseSub.current?.remove();
    };
  }, [clientNumber, navigationRef]);

  return pushToken;
}
