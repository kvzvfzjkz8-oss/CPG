# CPG — Mise en route sur ton ordinateur

## ⚠️ À savoir avant de commencer

**L'app mobile n'est pas encore branchée sur le vrai serveur (`cpg-api`).**
Elle tourne sur des données de démonstration (le fichier
`src/api/mobileMoneyApi.js` contient encore `api.cpg.ga`, une adresse
qui n'existe pas). Ce que tes équipes verront ce soir avec Expo Go,
c'est l'interface et les parcours — pas les vrais clients qu'on a créés
et testés ensemble aujourd'hui. Le branchement réel est une étape à
part, qu'on pourra faire dès que tu veux.

**Ce zip est aujourd'hui la seule copie du code.** Il n'y a pas encore
de dépôt Git. Avant toute chose, mets ces trois dossiers en sécurité
quelque part (voir la recommandation à la fin).

---

## CE SOIR — Tester avec Expo Go (5 minutes)

1. **Dézippe** les trois fichiers (`cpg-api.zip`, `cpg-admin.zip`,
   `cpg-mobile.zip`) dans un dossier sur ton ordinateur.

2. **Installe Node.js** si ce n'est pas déjà fait (version 18 ou plus) :
   https://nodejs.org

3. **Installe les dépendances de l'app mobile** :
   ```bash
   cd cpg-mobile
   npm install
   ```

4. **Lance le serveur de développement** :
   ```bash
   npx expo start --tunnel
   ```
   (le mode `--tunnel` fonctionne même si ton téléphone n'est pas sur
   le même Wi-Fi que ton ordinateur ; utilise `--lan` à la place si
   c'est le cas, ce sera plus rapide)

5. Un QR code s'affiche dans le terminal.

6. Sur un téléphone Android, installe **Expo Go** depuis le Play Store.

7. Ouvre Expo Go, scanne le QR code. L'app se charge.

C'est tout — aucune installation Android Studio nécessaire pour cette
étape.

---

## DEMAIN — Préparer un vrai fichier installable (.apk)

Un `.apk` est un vrai fichier d'application, installable sur n'importe
quel téléphone Android sans passer par le Play Store — utile pour la
phase d'apprentissage interne avant la mise en ligne officielle.

1. **Crée un compte Expo** (gratuit) sur https://expo.dev si tu n'en as
   pas déjà un.

2. **Installe l'outil EAS** :
   ```bash
   npm install -g eas-cli
   ```

3. **Connecte-toi** :
   ```bash
   eas login
   ```

4. **Depuis le dossier `cpg-mobile`**, initialise le projet (une seule
   fois — ça relie ce projet à ton compte Expo) :
   ```bash
   eas init
   ```

5. **Lance le build** (ce fichier `eas.json` est déjà préparé avec un
   profil `preview` qui génère un `.apk` directement installable) :
   ```bash
   eas build --profile preview --platform android
   ```

6. Le build tourne sur les serveurs d'Expo (5 à 15 minutes). Une fois
   terminé, un lien de téléchargement du `.apk` s'affiche dans le
   terminal — envoie-le à qui doit tester, ou télécharge-le et transfère-
   le par câble/Bluetooth.

7. Pour installer un `.apk` sur un téléphone Android, il faut parfois
   autoriser l'installation depuis une source inconnue dans les
   réglages de sécurité du téléphone (Android le demande automatiquement
   à la première installation).

---

## Une recommandation avant d'aller plus loin

Le code de CPG (backend, back-office, app mobile) n'existe aujourd'hui
que dans cette session de travail avec Claude. Je recommande fortement
de créer un dépôt Git (GitHub ou GitLab, gratuit en privé) et d'y
pousser ces trois dossiers dès que possible. Ça sécurise le travail
déjà fait, et ça permettra à Claude Code (la version en ligne de
commande de Claude) de continuer à travailler directement dessus,
plutôt que de repartir d'un zip à chaque fois.
