-- ═══════════════════════════════════════════════════════════════════
--  018 — Table de clôture et mise à jour des vues de solde
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE caisse_clotures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caissier_id       UUID NOT NULL REFERENCES users(id),
  solde_avant       BIGINT NOT NULL,
  excedent_renvoye  BIGINT NOT NULL DEFAULT 0,
  cloturee_le       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- date_trunc() sur un TIMESTAMPTZ dépend du fuseau horaire de la
  -- session (donc pas IMMUTABLE) : impossible à utiliser directement
  -- dans un index. Cette colonne calculée une fois pour toutes à
  -- l'insertion contourne la contrainte proprement.
  jour_cloture      DATE GENERATED ALWAYS AS ((cloturee_le AT TIME ZONE 'UTC')::date) STORED
);

-- Une seule clôture par caissière et par jour calendaire.
CREATE UNIQUE INDEX idx_caisse_clotures_unique_jour
  ON caisse_clotures (caissier_id, jour_cloture);

-- Le retour d'excédent réduit le solde de la caissière, au même titre
-- qu'un retrait ou une dépense.
CREATE OR REPLACE VIEW caisse_soldes AS
SELECT
  caissier_id,
  COALESCE(SUM(CASE WHEN type IN ('appro', 'encaissement_client') THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type IN ('retrait_client', 'depense', 'retour_excedent') THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_operations
WHERE statut = 'validee'
GROUP BY caissier_id;
