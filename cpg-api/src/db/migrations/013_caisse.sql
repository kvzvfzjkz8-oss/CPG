-- ═══════════════════════════════════════════════════════════════════
--  013 — La Caisse : retraits guichet, réapprovisionnement, RIB
-- ═══════════════════════════════════════════════════════════════════
--
--  Principe : la caissière tient un budget en espèces (« sa caisse »).
--  Elle sert les retraits que les clients viennent chercher au
--  guichet, ce qui fait baisser sa caisse ; quand elle devient trop
--  basse, elle demande un réapprovisionnement. Les deux mouvements
--  passent par une validation du directeur avant d'avoir un effet
--  réel — jamais d'argent qui bouge sur la seule initiative de la
--  caissière, exactement comme pour les crédits.
--
--  Solde de caisse calculé, jamais stocké en dur (même principe que
--  account_balances pour les comptes clients) : +appro validées,
--  -retraits validés.

-- ─── Qui gère quel client ? ────────────────────────────────────────
-- Nécessaire pour imprimer le nom du gestionnaire sur un RIB : sans
-- ce champ, impossible de savoir qui a ouvert le compte d'un client.
ALTER TABLE users ADD COLUMN created_by UUID REFERENCES users(id);

CREATE TYPE caisse_operation_type AS ENUM ('retrait_client', 'appro');
CREATE TYPE caisse_operation_statut AS ENUM ('en_attente', 'validee', 'rejetee');

CREATE TABLE caisse_operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caissier_id   UUID NOT NULL REFERENCES users(id),
  type          caisse_operation_type NOT NULL,
  montant       BIGINT NOT NULL CHECK (montant > 0),

  -- Uniquement pour un retrait_client : qui est débité au guichet.
  client_id     UUID REFERENCES users(id),

  statut        caisse_operation_statut NOT NULL DEFAULT 'en_attente',
  motif         TEXT,

  demandee_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidee_le    TIMESTAMPTZ,
  decidee_par   UUID REFERENCES users(id),
  motif_rejet   TEXT,

  -- Une fois validé, un retrait_client génère une écriture réelle sur
  -- le compte du client : on garde le lien pour ne jamais la créer
  -- deux fois si la validation est rejouée par erreur.
  ledger_entry_id UUID REFERENCES ledger_entries(id),

  CONSTRAINT retrait_a_un_client
    CHECK (type <> 'retrait_client' OR client_id IS NOT NULL)
);

CREATE INDEX idx_caisse_operations_caissier ON caisse_operations(caissier_id, demandee_le DESC);
CREATE INDEX idx_caisse_operations_statut ON caisse_operations(statut) WHERE statut = 'en_attente';

CREATE VIEW caisse_soldes AS
SELECT
  caissier_id,
  COALESCE(SUM(CASE WHEN type = 'appro' THEN montant ELSE 0 END), 0)::BIGINT
    - COALESCE(SUM(CASE WHEN type = 'retrait_client' THEN montant ELSE 0 END), 0)::BIGINT
    AS solde
FROM caisse_operations
WHERE statut = 'validee'
GROUP BY caissier_id;

