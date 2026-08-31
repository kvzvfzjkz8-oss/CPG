-- ═══════════════════════════════════════════════════════════════════
--  016 — Solde de caisse : intègre dépenses et encaissements
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW caisse_soldes AS
SELECT
  caissier_id,
  COALESCE(SUM(CASE WHEN type IN ('appro', 'encaissement_client') THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type IN ('retrait_client', 'depense') THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_operations
WHERE statut = 'validee'
GROUP BY caissier_id;
