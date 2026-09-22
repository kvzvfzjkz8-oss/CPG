-- Clôture mensuelle des coffres : d'un clic, le directeur archive le
-- solde constaté d'un coffre et repart à zéro pour la période
-- suivante. Rien n'est supprimé des tables source (applied_fees,
-- ledger_entries, coffre_transferts) — seule la date de la dernière
-- clôture sert de nouveau point de départ au calcul du solde courant.

CREATE TABLE coffre_clotures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coffre         coffre_type NOT NULL,
  montant        BIGINT NOT NULL,
  periode_debut  TIMESTAMPTZ NOT NULL,
  periode_fin    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cloturee_par   UUID NOT NULL REFERENCES users(id),
  cloturee_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coffre_clotures_coffre ON coffre_clotures(coffre, cloturee_le DESC);
