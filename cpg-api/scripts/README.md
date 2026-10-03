# Scripts d'opérations ponctuelles

Scripts à usage unique exécutés sur la base de production, conservés
pour la traçabilité et la possibilité de rejouer ou d'auditer une
opération. Ils ne font pas partie du service : rien dans `src/` ne les
importe.

Tous lisent la connexion dans `DATABASE_URL` et aucun ne contient de
secret. Depuis un poste local, la base de production n'est joignable
que par un tunnel Railway :

```bash
DATABASE_URL="postgresql://..." node scripts/<script>.mjs
```

## Lecture seule (aucune écriture)

| Script | Rôle |
|---|---|
| `verifier_credits_scolaires.mjs` | Liste les crédits du produit « rentrée scolaire ». |
| `verifier_echeances_scolaires.mjs` | Contrôle que les échéances scolaires impayées tombent bien les 25/01, 24/02 et 25/03/2027. |
| `verifier_echeances_scolaires2.mjs` | Même contrôle, comparaison des dates faite en SQL (la v1 décalait d'un fuseau). |
| `diagnostiquer_3_credits.mjs` | Détaille l'échéancier de CPG-3008, CPG-4728 et CPG-9458. |

## Écriture (modifient les données)

| Script | Rôle |
|---|---|
| `import_credits_historiques.mjs` | Importe les crédits de l'ancien logiciel depuis `legacy_import_data.json`. Rejouable : chaque ligne déjà présente dans `legacy_credit_imports` est ignorée. |
| `annuler_imports_exclus.mjs` | Retire les 13 crédits importés par erreur (écritures liées, échéancier, traçabilité, puis le crédit). |
| `realigner_echeances_27.mjs` | Décale les échéances impayées des crédits importés sur le 27 de mois consécutifs. Rejouable. |
| `aligner_echeances_scolaires.mjs` | Place les 3 échéances des crédits scolaires aux 25/01, 24/02 et 25/03/2027. Ne touche jamais une échéance déjà réglée. |
| `corriger_3_echeances.mjs` | Corrige les 3 échéances (sur 120) qui avaient hérité d'une mauvaise date lors du réalignement scolaire. |

## `legacy_import_data.json`

Données source de l'import historique : 54 dossiers de crédit réels
(montants, mensualités, employeur, identifiants clients). **Volontairement
exclu de git** (voir le `.gitignore` racine) — il reste en local
uniquement. `import_credits_historiques.mjs` le lit à côté de lui.
