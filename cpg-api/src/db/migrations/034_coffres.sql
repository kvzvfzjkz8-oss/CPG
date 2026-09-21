-- ═══════════════════════════════════════════════════════════════════
--  034 — Coffres de l'entreprise (frais & agios, remboursements,
--         frais de dossier)
-- ═══════════════════════════════════════════════════════════════════
--
--  Trois coffres, alimentés automatiquement dès qu'un frais/agio, un
--  remboursement, ou une commission de déblocage est encaissé — pas
--  besoin d'y écrire à chaque prélèvement, leur solde se calcule en
--  lisant applied_fees / ledger_entries directement (toujours exact,
--  jamais désynchronisé). Seule la table ci-dessous enregistre les
--  mouvements qui, eux, ne se déduisent pas automatiquement : les
--  transferts entre coffres, ou vers la caisse principale — décidés
--  par le directeur seul.
--
--  Visibles en lecture par la caissière et le directeur ; les
--  transferts restent réservés au directeur.

CREATE TYPE coffre_type AS ENUM ('frais_agios', 'remboursements', 'frais_dossier');

CREATE TABLE coffre_transferts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coffre_source  coffre_type NOT NULL,
  -- destination : soit un autre coffre_type, soit le texte littéral
  -- 'caisse_principale' — pas de colonne dédiée, pour ne pas dupliquer
  -- l'enum coffre_type avec une valeur qui n'a pas de solde propre ici.
  destination    TEXT NOT NULL,
  montant        BIGINT NOT NULL CHECK (montant > 0),
  motif          TEXT,
  cree_par       UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un transfert de coffre vers la caisse principale alimente aussi la
-- caisse principale existante, pour rester cohérent avec cet écran
-- déjà en place.
ALTER TYPE caisse_principale_mouvement_type ADD VALUE IF NOT EXISTS 'alimentation_depuis_coffre';
