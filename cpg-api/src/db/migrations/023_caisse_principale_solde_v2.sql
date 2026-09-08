-- ═══════════════════════════════════════════════════════════════════
--  023 — Solde de la caisse principale : intègre les déblocages
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW caisse_principale_solde AS
SELECT
  COALESCE(SUM(CASE WHEN type = 'alimentation' THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type IN ('transfert_vers_caissiere', 'deblocage_credit') THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_principale_mouvements;
