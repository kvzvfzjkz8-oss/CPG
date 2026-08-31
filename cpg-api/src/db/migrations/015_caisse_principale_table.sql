-- ═══════════════════════════════════════════════════════════════════
--  015 — Caisse principale : table et vue de solde
-- ═══════════════════════════════════════════════════════════════════

-- Mouvements de la caisse centrale de l'entreprise, distincte des
-- caisses individuelles des caissières :
--   - alimentation           : le directeur y injecte des fonds
--                               (retrait bancaire apporté au bureau,
--                               apport personnel...)
--   - transfert_vers_caissiere : une part part vers la caisse d'une
--                               caissière, au moment où son
--                               réapprovisionnement est validé.
CREATE TYPE caisse_principale_mouvement_type AS ENUM ('alimentation', 'transfert_vers_caissiere');

CREATE TABLE caisse_principale_mouvements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          caisse_principale_mouvement_type NOT NULL,
  montant       BIGINT NOT NULL CHECK (montant > 0),

  -- Uniquement pour un transfert vers une caissière.
  caissier_id   UUID REFERENCES users(id),
  operation_id  UUID REFERENCES caisse_operations(id),

  motif         TEXT,
  cree_par      UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transfert_a_une_caissiere
    CHECK (type <> 'transfert_vers_caissiere' OR caissier_id IS NOT NULL)
);

CREATE VIEW caisse_principale_solde AS
SELECT
  COALESCE(SUM(CASE WHEN type = 'alimentation' THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type = 'transfert_vers_caissiere' THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_principale_mouvements;
