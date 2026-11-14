-- ═══════════════════════════════════════════════════════════════════
--  064 — PARTICULIER OU ENTREPRISE, ET DES FRAIS DE TENUE DIFFÉRENTS
-- ═══════════════════════════════════════════════════════════════════
--
-- « C'est bien de différencier une entreprise d'un particulier car les
--   frais de tenue ne sont pas les mêmes mais plus élevés. »
--   (direction, 14/11/2026)
-- « Oui je valide pour la fiche client (particulier ou entreprise) et
--   oui un second barème frais de tenue entreprise (15 000 F). »
--
-- CE QU'ON NE FAIT PAS
--   Pas de table « entreprises », pas de nouveau rôle, pas de personne
--   morale au sens juridique — la direction a écarté cette voie le
--   14/11/2026. Une entreprise reste un client, avec sa raison sociale
--   en guise de nom. On ajoute seulement de quoi la reconnaître.
--
-- POURQUOI UNE COLONNE ET PAS LE CHAMP « POSTE »
--   On aurait pu écrire « Personne morale » dans `job_title`, qui est
--   du texte libre. Mais personne ne l'écrirait deux fois pareil, et le
--   prélèvement des frais ne peut pas reposer sur une convention de
--   saisie : un « personne morale » mal orthographié coûterait 8 500 F
--   par mois à la maison, sans que rien ne le signale.
--
-- LE SECOND BARÈME
--   Il vit dans le catalogue existant, avec son versionnement et son
--   historique : la direction le règle depuis l'écran Catalogue comme
--   n'importe quel autre frais. `collectTenueCompte` choisit le barème
--   selon le type du client, au lieu de prendre le premier actif.

CREATE TYPE client_type AS ENUM ('particulier', 'entreprise');

-- Par défaut particulier : les 229 clients existants le sont tous, et
-- c'est ce qu'on crée dans l'immense majorité des cas.
ALTER TABLE users
  ADD COLUMN type_client client_type NOT NULL DEFAULT 'particulier';

-- Seul un client a un type. Un agent n'en a pas — la contrainte le dit,
-- plutôt que de laisser croire qu'un opérateur pourrait être une
-- entreprise.
ALTER TABLE users
  ADD CONSTRAINT type_client_reserve_aux_clients
  CHECK (role = 'client' OR type_client = 'particulier');

CREATE INDEX idx_users_type_client ON users(type_client) WHERE role = 'client';

-- ── Le barème entreprise ───────────────────────────────────────────
--
-- Même déclencheur `tenue_compte` que le barème des particuliers : les
-- deux coexistent, et c'est le service qui tranche selon le client.
-- L'auteur reste NULL : une migration ne doit dependre d'aucune donnee.
-- Mon premier jet allait chercher le directeur — sur une base neuve, les
-- migrations tournent AVANT le seed, aucun directeur n'existe encore, et
-- le bareme ne se creait pas du tout. La colonne accepte NULL, et la
-- note dit d'ou vient la decision.
INSERT INTO fee_definitions
  (code, name, description, basis, trigger_on, status, activated_at)
VALUES (
  'FRAIS_TENUE_ENTREPRISE',
  'Frais de tenue de compte — entreprise',
  'Forfait mensuel appliqué aux comptes d''entreprise, plus élevé que celui des particuliers.',
  'fixe',
  'tenue_compte',
  'actif',
  now()
);

INSERT INTO fee_versions
  (fee_id, version, amount, rate, min_amount, max_amount, exempt_below, note)
SELECT f.id, 1, 15000, 0, 0, NULL, 0,
       'Barème posé par la direction le 14/11/2026'
FROM fee_definitions f
WHERE f.code = 'FRAIS_TENUE_ENTREPRISE';
