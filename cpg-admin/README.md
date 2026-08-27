# CPG Admin — Back-office

Interface d'administration du Crédit Populaire du Gabon. React + Vite. Conçue d'après le §3 du cahier des charges : **simple, épurée et compartimentée** — chaque collaborateur ne voit que ce qui concerne son poste.

---

## 1. Lancer le projet

Node.js 18 ou plus récent.

```bash
cd cpg-admin
npm install
npm run dev
```

Ouvrez `http://localhost:5173`.

Le sélecteur de poste dans la barre latérale permet de basculer entre les deux rôles pour la démonstration. En production, le rôle viendra de l'authentification et ce sélecteur disparaîtra.

Pour compiler la version de production : `npm run build`, puis servez le dossier `dist/`.

---

## 2. Les deux rôles

**Opérateur de crédit / Conseiller**
- Demandes de crédit entrantes, avec validation de premier niveau ou rejet
- Vérification des pièces du dossier client
- Messagerie : réponses aux clients

**Gestionnaire / Superviseur**
- Statistiques financières : crédits accordés, encours, volume Mobile Money, impayés
- Validation finale des crédits (déclenche le déblocage des fonds)
- Gestion des utilisateurs, employés comme clients
- Supervision des transactions Mobile Money

La séparation est définie dans `src/auth/roles.js`, source unique de vérité pour l'affichage.

---

## 3. Avertissement de sécurité

**Masquer un onglet dans le navigateur n'est pas une protection.** Un utilisateur peut ouvrir les outils de développement et modifier le JavaScript de la page pour afficher n'importe quelle vue.

Le backend doit revérifier le rôle **à chaque requête** : approuver un crédit, lister les utilisateurs, consulter les transactions. `src/auth/roles.js` gère le confort d'usage ; le serveur gère la sécurité. Un back-office bancaire dont les permissions ne sont vérifiées que côté navigateur n'est pas sécurisé.

---

## 4. Brancher le backend

Tout passe par **`src/api/adminApi.js`**. Les vues n'appellent que ces fonctions, donc l'interface ne bougera pas quand vous connecterez le serveur réel. Chaque emplacement à remplir est marqué `TODO`.

Fonctions à implémenter : `validateLevel1`, `approveCredit`, `rejectCredit`, `fetchUsers`, `setUserStatus`, `fetchMomoTransactions`, `sendAdvisorReply`, `notifyClient`.

Configurez l'URL du backend dans un fichier `.env` :

```
VITE_API_URL=https://api.cpg.ga
```

---

## 5. Lien avec les notifications push

Le back-office **ne fait pas** partir les notifications lui-même : c'est le backend qui détient les push tokens enregistrés par l'application mobile.

```
Back-office ──► Backend CPG ──► API Expo Push ──► APNs / FCM ──► téléphone du client
```

Quand un gestionnaire approuve un crédit, `approveCredit()` appelle `notifyClient()`, qui signalera l'événement au backend. Celui-ci retrouve le token du client et envoie l'alerte.

Événements qui déclenchent une push :

| Action back-office | Notification reçue par le client |
|---|---|
| Crédit approuvé | « Votre crédit de X FCFA a été approuvé » |
| Crédit rejeté | « Votre demande n'a pas été retenue » |
| Réponse d'un conseiller | « Sylvie M. vous a répondu » |
| Transaction Mobile Money confirmée | « X FCFA reçus via Airtel Money » |

Côté application mobile, la réception est déjà implémentée dans `cpg-mobile/src/notifications/pushNotifications.js`.

---

## 6. Structure

```
cpg-admin/
├── index.html
├── vite.config.js
└── src/
    ├── main.jsx
    ├── App.jsx                 barre latérale, en-tête, aiguillage par rôle
    ├── theme.js                couleurs et polices (identiques à l'app mobile)
    ├── auth/roles.js           rôles et matrice de permissions
    ├── api/adminApi.js         ← point d'intégration backend
    ├── data/mockData.js        données de démonstration
    ├── components/UI.jsx       Card, Badge, Tabs, tableaux
    └── views/
        ├── OperatorView.jsx
        └── SupervisorView.jsx
```

---

## 7. Reste à faire pour la production

1. Authentification réelle (session, expiration, double facteur pour le gestionnaire)
2. Vérification des permissions côté serveur
3. Journal d'audit : qui a approuvé quel crédit, quand — exigence réglementaire
4. Pagination et filtres sur les listes, qui grossiront vite
5. Sauvegarde et politique de conservation des données conformes à la réglementation bancaire gabonaise
