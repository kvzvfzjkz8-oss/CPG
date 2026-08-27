# CPG Mobile — application client

Application React Native (Expo) pour le Crédit Populaire du Gabon, développée d'après le cahier des charges. Une seule base de code pour Android et iOS.

---

## 1. Lancer l'application sur votre iPhone

Aucun compte développeur Apple n'est nécessaire pour tester.

**Sur l'ordinateur** (Node.js 18+ installé) :

```bash
npm install -g expo-cli      # une seule fois
cd cpg-mobile
npm install
npx expo start
```

Un QR code s'affiche dans le terminal.

**Sur l'iPhone** :

1. Installez **Expo Go** depuis l'App Store (gratuit)
2. Ouvrez l'appareil photo et scannez le QR code
3. L'application s'ouvre

Le téléphone et l'ordinateur doivent être sur le même réseau Wi-Fi. Si le réseau bloque la connexion, lancez `npx expo start --tunnel`.

**Code PIN de démonstration : 1234** — ou touchez l'icône biométrie pour utiliser Face ID / l'empreinte.

---

## 2. Ce qui est couvert

| Cahier des charges | État |
|---|---|
| 2.1 Tableau de bord : solde, crédit en cours, historique | Fait |
| 2.2 Opérations Mobile Money | Interface faite, **API à brancher** |
| 2.3 Simulation, demande en ligne, suivi des échéances | Fait |
| 2.4 Messagerie avec un conseiller | Interface faite, **backend à brancher** |
| 2.4 Notifications push | Fait côté app (réception, rappels locaux, routage), **envoi serveur à brancher** |
| 4. Android + iOS | Fait (base de code unique) |
| 4. PIN + biométrie | Fait (biométrie native via `expo-local-authentication`) |
| 4. Chiffrement, conformité bancaire | **À traiter côté backend** |

Les données affichées sont fictives (`src/data/mockData.js`) et remplaceront des appels au backend CPG.

---

## 3. Brancher le Mobile Money

Tout se passe dans **`src/api/mobileMoneyApi.js`**. Ce fichier est aujourd'hui un simulateur ; les écrans ne connaissent que ses trois fonctions, donc l'interface n'aura pas à changer.

```
App mobile  ──►  Backend CPG  ──►  API Airtel Money / Moov Money
                 (garde les clés,       (débit / crédit réel)
                  signe, journalise)
```

Règle à ne pas contourner : **aucune clé opérateur dans l'application mobile.** Une app installée sur un téléphone est lisible par n'importe qui ; les identifiants marchands doivent rester sur le serveur CPG.

À obtenir auprès des opérateurs : identifiants marchands, URL d'API, endpoints *collection* (entrant) et *disbursement* (sortant), URL de webhook pour les confirmations.

Les emplacements exacts à remplir sont marqués `TODO` dans le fichier.

---

## 3 bis. Notifications push

Tout est dans **`src/notifications/pushNotifications.js`**. Deux mécanismes cohabitent :

**Push distantes** (serveur → téléphone) pour les événements : crédit approuvé, transaction confirmée, réponse du conseiller.

```
Backend CPG ──► API Expo Push ──► APNs (iOS) / FCM (Android) ──► téléphone
```

Au démarrage, l'app récupère un « push token » et doit le transmettre au backend (`sendTokenToBackend`, marqué `TODO`). Sans ce token, le serveur ne sait pas quel appareil viser.

**Rappels locaux** (téléphone → téléphone) pour les échéances de remboursement, dont la date est connue à l'avance. Ils fonctionnent **hors connexion** : un agent de la voie en zone sans réseau reçoit quand même son rappel, 3 jours avant le prélèvement.

Pour tester : ouvrez l'onglet **Profil → Préférences d'alertes → Envoyer une notification de test**. La notification arrive 2 secondes plus tard ; en touchant l'alerte, l'app s'ouvre sur l'écran concerné.

Deux limites à connaître :
- Les push **distantes** ne fonctionnent pas sur simulateur, il faut un téléphone réel
- Dans Expo Go, elles fonctionnent en développement ; pour la production il faudra un build EAS avec les certificats APNs (iOS) et FCM (Android)

Les rappels locaux, eux, fonctionnent partout.

---

## 4. Structure du projet

```
cpg-mobile/
├── App.js                      navigation + verrouillage
├── app.json                    config Expo (nom, icônes, Face ID)
└── src/
    ├── theme.js                couleurs, polices, format FCFA
    ├── api/
    │   └── mobileMoneyApi.js   ← point d'intégration opérateur
    ├── notifications/
    │   └── pushNotifications.js  ← push + rappels d'échéance
    ├── data/mockData.js        données de démonstration
    ├── components/
    │   ├── UI.js               Card, Pill, boutons, en-têtes
    │   └── RailProgress.js     échéancier en forme de voie ferrée
    └── screens/
        ├── LockScreen.js       PIN + biométrie
        ├── DashboardScreen.js
        ├── CreditsScreen.js    suivi · simulation · demande
        ├── MobileMoneyScreen.js
        ├── ChatScreen.js
        └── ProfileScreen.js
```

---

## 5. Polices

Le projet utilise les polices système pour démarrer sans configuration. Pour passer aux polices de marque :

```bash
npx expo install expo-font @expo-google-fonts/space-grotesk @expo-google-fonts/inter
```

puis chargez-les dans `App.js` et remplacez les valeurs de `fonts` dans `src/theme.js`.

---

## 6. Passer en production

1. **Backend** : API d'authentification, comptes, crédits, messagerie ; chiffrement TLS et au repos ; journalisation conforme à la réglementation bancaire gabonaise
2. **Notifications push** : `expo-notifications` côté app, envoi côté serveur
3. **Compte Apple Developer** (99 $/an) et **Google Play Console** (25 $ une fois)
4. **Build** : `eas build --platform ios` puis distribution TestFlight avant l'App Store
5. **Audit de sécurité** avant toute mise en ligne manipulant de l'argent réel

---

## Avertissement

Ce projet est une base de développement, pas une application bancaire prête à l'emploi. Il ne doit pas traiter d'argent réel avant l'implémentation du backend sécurisé et un audit de sécurité.
