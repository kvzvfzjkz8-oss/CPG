-- ─────────────────────────────────────────────────────────────────────
--  CORRECTION D'ÉCHÉANCE SOUMISE À VALIDATION DU DIRECTEUR
-- ─────────────────────────────────────────────────────────────────────
--
-- L'opérateur garde la main pour signaler qu'une échéance doit être
-- corrigée, mais la correction elle-même ne s'applique qu'après
-- validation du directeur — même principe que rate_change_requests
-- pour les barèmes : on propose, on ne modifie pas soi-même.
--
-- Réutilise change_status (en_attente, approuve, rejete), déjà défini
-- en migration 003 pour exactement ce même usage.

CREATE TABLE installment_adjustment_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id  UUID NOT NULL REFERENCES installments(id),
  nouvelle_date   DATE NOT NULL,
  motif           TEXT NOT NULL,
  status          change_status NOT NULL DEFAULT 'en_attente',

  requested_by    UUID NOT NULL REFERENCES users(id),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,

  -- Séparation des tâches : qui propose la correction ne peut pas être
  -- celui qui la valide — imposé en base, pas seulement côté API.
  CONSTRAINT no_self_decision_echeance CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX idx_installment_adjustments_status ON installment_adjustment_requests(status, requested_at DESC);

-- Une seule demande en attente à la fois par échéance : au-delà, on ne
-- sait plus laquelle le directeur est censé arbitrer.
CREATE UNIQUE INDEX idx_installment_adjustments_pending
  ON installment_adjustment_requests(installment_id)
  WHERE status = 'en_attente';
