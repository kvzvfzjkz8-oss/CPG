-- ═══════════════════════════════════════════════════════════════════
--  039 — Suppression d'un dossier en double validation : désormais
--         soumise à confirmation du directeur
-- ═══════════════════════════════════════════════════════════════════
--
--  Jusqu'ici, l'opérateur supprimait directement un dossier arrivé en
--  double validation (voir credit_deletion_reports, migration 033) —
--  la trace envoyée au directeur n'était qu'un rapport après coup.
--  Le directeur demande désormais que la suppression soit confirmée
--  par lui AVANT d'être effective : l'opérateur propose, il ne
--  supprime plus lui-même.
--
--  Même principe que installment_adjustment_requests (migration 007) :
--  une table de demandes en attente d'arbitrage, avec séparation des
--  tâches imposée en base (qui propose ne peut pas décider).
--
--  Une fois approuvée, la demande est traitée exactement comme
--  l'ancienne suppression directe : le crédit passe à 'annule' et un
--  rapport est ajouté à credit_deletion_reports (corbeille), donc la
--  restauration existante continue de fonctionner sans changement.

CREATE TABLE credit_deletion_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id       UUID NOT NULL REFERENCES credit_requests(id),
  motif           TEXT NOT NULL,
  status          change_status NOT NULL DEFAULT 'en_attente',

  requested_by    UUID NOT NULL REFERENCES users(id),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,

  -- Séparation des tâches : qui propose la suppression ne peut pas
  -- être celui qui la confirme — imposé en base, pas seulement côté API.
  CONSTRAINT no_self_decision_suppression_credit CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX idx_credit_deletion_requests_status ON credit_deletion_requests(status, requested_at DESC);

-- Une seule demande en attente à la fois par dossier.
CREATE UNIQUE INDEX idx_credit_deletion_requests_pending
  ON credit_deletion_requests(credit_id)
  WHERE status = 'en_attente';
