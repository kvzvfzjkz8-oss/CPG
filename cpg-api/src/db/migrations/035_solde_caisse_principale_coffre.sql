-- ═══════════════════════════════════════════════════════════════════
--  035 — Solde de la caisse principale : intègre les transferts
--         depuis les coffres
-- ═══════════════════════════════════════════════════════════════════
--
--  Séparée de 034 : PostgreSQL n'autorise pas d'utiliser une valeur
--  d'enum tout juste ajoutée (ALTER TYPE ... ADD VALUE) dans la même
--  transaction — donc jamais dans la même migration que sa création.

CREATE OR REPLACE VIEW caisse_principale_solde AS
SELECT
  COALESCE(SUM(CASE WHEN type IN ('alimentation', 'alimentation_depuis_coffre') THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type IN ('transfert_vers_caissiere', 'deblocage_credit') THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_principale_mouvements;
