-- ═══════════════════════════════════════════════════════════════════
--  FRAIS PRÉLEVÉ PONCTUELLEMENT — colonnes et garde-fous
-- ═══════════════════════════════════════════════════════════════════
--
-- Suite de la 046. Deux colonnes seulement, et une contrainte qui dit
-- tout ce qu'un frais ponctuel doit être.
--
--   • nature_frais : « frais_tenue » ou « agios ». Rien d'autre. Le
--     montant n'est pas stocké comme une saisie libre de l'opératrice :
--     il est calculé depuis le barème en vigueur (voir
--     previewFraisPonctuel), puis recalculé à la validation.
--
--   • periode_frais : le MOIS concerné, toujours au premier du mois.
--     C'est la colonne qui permet de rattraper un mois passé — le cas
--     d'usage réel : « cela n'a pas été fait en octobre ». Et c'est
--     elle qui aligne le prélèvement ponctuel sur la même période que
--     le prélèvement automatique, donc sur la même protection contre
--     le double prélèvement (contrainte d'unicité de applied_fees).
--
-- Un frais ne touche AUCUNE caisse : il ne sort pas d'un tiroir et
-- n'alimente pas la caisse principale — exactement comme le
-- prélèvement automatique du 25. Faire autrement rendrait les deux
-- chemins incohérents entre eux. D'où caissier_id obligatoirement nul,
-- et aucune écriture dans caisse_principale_mouvements.

ALTER TABLE caisse_operations
  ADD COLUMN IF NOT EXISTS nature_frais  TEXT,
  ADD COLUMN IF NOT EXISTS periode_frais DATE;

ALTER TABLE caisse_operations
  DROP CONSTRAINT IF EXISTS caisse_operations_frais_ponctuel_check;

ALTER TABLE caisse_operations
  ADD CONSTRAINT caisse_operations_frais_ponctuel_check CHECK (
    type <> 'frais_ponctuel' OR (
      client_id IS NOT NULL
      -- Aucun guichet n'est impliqué : un frais n'est pas servi en
      -- espèces. Les vues de caisse excluent déjà les lignes sans
      -- caissier, donc aucune caisse fantôme n'apparaît.
      AND caissier_id IS NULL
      AND destination = 'cpg'
      -- Le motif dit pourquoi le prélèvement automatique a été
      -- rattrapé à la main. Sans lui, impossible de s'y retrouver
      -- trois semaines plus tard.
      AND motif IS NOT NULL AND btrim(motif) <> ''
      AND nature_frais IN ('frais_tenue', 'agios')
      -- Toujours un mois entier, jamais une date quelconque : c'est ce
      -- qui a manqué le 14/10/2026, quand trois périodes différentes
      -- pour le même mois ont permis 189 doubles prélèvements.
      AND periode_frais IS NOT NULL
      AND EXTRACT(DAY FROM periode_frais) = 1
    )
  );

-- Retrouver vite ce qui a déjà été rattrapé sur un compte.
CREATE INDEX IF NOT EXISTS idx_caisse_operations_frais_ponctuel
  ON caisse_operations (client_id, nature_frais, periode_frais)
  WHERE type = 'frais_ponctuel';
