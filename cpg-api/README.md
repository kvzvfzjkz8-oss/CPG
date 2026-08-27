# CPG API — Backend

API du Crédit Populaire du Gabon. Node.js + Express + PostgreSQL. Sert l'application mobile et le back-office.

---

## 1. Démarrer

Prérequis : Node.js 18+, PostgreSQL 14+.

```bash
cd cpg-api
npm install

createdb cpg                    # ou via votre outil PostgreSQL
cp .env.example .env            # puis renseignez DATABASE_URL

npm run migrate                 # crée le schéma
npm run seed                    # données de démonstration
npm run dev                     # http://localhost:4000
```

Vérification : `curl http://localhost:4000/sante`

**Générez de vrais secrets JWT avant tout déploiement :**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Le serveur refuse de démarrer en production si les secrets par défaut sont encore en place.

### Comptes de démonstration

| Interface | Identifiant | Secret |
|---|---|---|
| Back-office, opérateur | `sylvie@cpg.ga` | `MotDePasseDemo2026!` |
| Back-office, superviseur | `david@cpg.ga` | `MotDePasseDemo2026!` |
| Application mobile | `+24106000001` | PIN `1234` |

---

## 2. Endpoints

Base : `/v1`. Authentification par `Authorization: Bearer <accessToken>`.

### Authentification

| Méthode | Route | Qui |
|---|---|---|
| POST | `/auth/connexion-client` | mobile, téléphone + PIN |
| POST | `/auth/connexion-agent` | back-office, email + mot de passe |
| POST | `/auth/rafraichir` | renouvelle le jeton d'accès |
| POST | `/auth/deconnexion` | révoque les sessions |
| GET | `/auth/moi` | profil et permissions |

### Application mobile — `/client`

| Méthode | Route | Objet |
|---|---|---|
| GET | `/compte` | solde et titulaire |
| GET | `/transactions` | historique paginé par curseur |
| POST | `/credits/simulation` | mensualité estimée, sans enregistrement |
| POST | `/credits` | soumission d'une demande |
| GET | `/credits` | crédits et échéancier |
| POST | `/momo` | initier un dépôt ou un envoi |
| GET | `/momo/:reference` | suivi d'une opération |
| GET / POST | `/messages` | messagerie conseiller |
| POST | `/appareils` | enregistrement du token push |
| GET | `/notifications` | historique des alertes |

### Back-office — `/admin`

| Méthode | Route | Rôle requis |
|---|---|---|
| GET | `/credits` | opérateur, superviseur |
| GET | `/credits/:id` | opérateur, superviseur |
| POST | `/credits/:id/valider-niveau1` | **opérateur** |
| POST | `/credits/:id/approuver` | **superviseur** |
| POST | `/credits/:id/rejeter` | opérateur, superviseur |
| GET | `/conversations` | opérateur |
| POST | `/conversations/:id/messages` | opérateur |
| GET / POST | `/utilisateurs` | **superviseur** |
| PATCH | `/utilisateurs/:id/statut` | **superviseur** |
| GET | `/momo` | **superviseur** |
| GET | `/statistiques` | **superviseur** |
| GET | `/audit` | **superviseur** |

### Webhooks

| Méthode | Route | Appelé par |
|---|---|---|
| POST | `/webhooks/momo/:operateur` | Airtel / Moov |

---

## 3. Ce que le code protège déjà

**Les permissions sont vérifiées ici, pas dans le navigateur.** C'est le point que je signalais dans le README du back-office : masquer un onglet n'est pas une protection. Chaque route sensible passe par `requirePermission()`. Une requête forgée à la main, sans passer par l'interface, est rejetée.

**Le rôle est relu en base à chaque requête**, jamais pris dans le jeton. Un employé suspendu perd ses droits immédiatement, sans attendre l'expiration de sa session.

**Double validation avec séparation des tâches.** Un gestionnaire ne peut pas approuver un dossier qu'il a lui-même validé en premier niveau : contrainte en base (`no_self_approval`) et vérification applicative.

**Le solde n'est pas un champ modifiable.** Il est calculé à partir d'un journal en ajout seul. Une erreur se corrige par une écriture inverse, jamais par une suppression : les comptes restent auditables.

**Montants en entiers.** Le franc CFA n'a pas de sous-unité et les flottants sont inutilisables pour de l'argent — `0.1 + 0.2 ≠ 0.3`, ce qui devient une perte de fonds réelle sur un solde.

**Secrets jamais stockés en clair.** Codes PIN et mots de passe en bcrypt coût 12. Les jetons de rafraîchissement sont stockés sous forme d'empreinte et tournent à chaque usage.

**Limitation des tentatives.** Un PIN à 4 chiffres, c'est 10 000 combinaisons : sans limite, il tombe en minutes. Dix essais par quart d'heure, puis blocage temporaire du compte.

**Journal d'audit.** Qui a approuvé quel crédit, quand, depuis quelle adresse. Exigence réglementaire, et seul moyen de détecter qu'un employé consulte des dossiers sans motif.

---

## 4. Brancher le Mobile Money

Un seul fichier : **`src/services/mobileMoneyService.js`**.

```
App mobile ──► cette API ──► API opérateur ──► push USSD au client
                                    │
                                    ▼  (le client saisit son code)
                           webhook opérateur
                                    │
                                    ▼
                    écriture au journal + push de confirmation
```

**Le compte n'est jamais crédité à l'initiation.** Rien ne bouge tant que le webhook opérateur n'a pas confirmé. Créditer plus tôt reviendrait à donner de l'argent pour une opération que le client peut encore refuser.

**Le webhook doit être signé.** La route est publique — elle doit l'être, l'opérateur ne peut pas porter un jeton CPG. Toute la protection repose sur `verifyWebhookSignature()`. Sans elle, quiconque devine l'URL peut se faire créditer. Demandez à chaque opérateur son format de signature.

À obtenir auprès d'Airtel Gabon et Moov Gabon : identifiants marchands, URL d'API, endpoints *collection* et *disbursement*, URL de webhook à leur déclarer.

Ces identifiants vivent dans le `.env` du serveur. **Jamais dans l'application mobile** : une app installée est lisible par n'importe qui.

---

## 5. Notifications push

`src/services/pushService.js` ferme la boucle des trois projets :

```
App mobile enregistre son token   ──►  table devices
Back-office approuve un crédit    ──►  notifyUser()
notifyUser()                      ──►  Expo  ──►  APNs / FCM  ──►  téléphone
```

Les modèles de message sont centralisés dans `TEMPLATES`, pour garder un ton cohérent. Les tokens périmés sont supprimés automatiquement quand Expo les signale.

`sendUpcomingInstallmentReminders()` est prévue pour une tâche planifiée quotidienne. Elle double les rappels locaux de l'application, utiles si le client a réinstallé l'app.

---

## 6. Structure

```
cpg-api/
├── .env.example
└── src/
    ├── server.js               démarrage, arrêt propre
    ├── app.js                  middlewares, montage des routes
    ├── config.js               variables d'environnement
    ├── db/
    │   ├── index.js            pool PostgreSQL, transactions
    │   ├── migrate.js
    │   ├── seed.js
    │   └── migrations/001_initial.sql
    ├── middleware/
    │   ├── auth.js             ← contrôle d'accès
    │   ├── errorHandler.js
    │   └── validate.js
    ├── services/
    │   ├── mobileMoneyService.js  ← intégration opérateur
    │   ├── pushService.js         ← notifications
    │   ├── creditService.js       barème et échéancier
    │   └── auditService.js
    ├── routes/
    │   ├── auth.routes.js
    │   ├── client.routes.js
    │   ├── admin.routes.js
    │   └── webhooks.routes.js
    └── utils/permissions.js    ← matrice des rôles
```

---

## 7. Reste à faire avant la production

1. **Tests automatisés**, en priorité sur les parcours d'argent et les permissions
2. **Double facteur** pour les comptes superviseur
3. **Stockage des pièces justificatives** : stockage objet chiffré, URL signées à durée limitée — le schéma prévoit `storage_key`, l'implémentation reste à faire
4. **Chiffrement au repos** de la base et sauvegardes testées par restauration réelle
5. **Tâches planifiées** : rappels d'échéance, passage en retard des impayés, prélèvements automatiques
6. **Conformité COBAC / réglementation gabonaise** : durée de conservation, déclarations, KYC
7. **Audit de sécurité externe** avant toute mise en ligne manipulant de l'argent réel

---

## Avertissement

Ce projet est une base de développement solide, pas un système bancaire certifié. Il ne doit pas traiter d'argent réel avant les points ci-dessus, en particulier l'audit externe. Je n'ai pas pu exécuter les migrations ni les tests dans mon environnement : attendez-vous à des ajustements au premier lancement.
