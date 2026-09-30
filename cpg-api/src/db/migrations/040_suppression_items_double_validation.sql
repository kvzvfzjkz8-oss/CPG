-- ═══════════════════════════════════════════════════════════════════
--  040 — Suppression d'un dossier en difficulté / demande exceptionnelle
--         en attente de double validation — même circuit de
--         confirmation par le directeur que pour les crédits (039).
-- ═══════════════════════════════════════════════════════════════════
--
--  Jusqu'ici, aucune suppression n'était possible du tout pour ces
--  points de l'ordre du jour une fois arrivés en attente de double
--  validation (contrairement aux crédits, qui avaient au moins
--  l'ancien circuit de suppression directe). On applique directement
--  le circuit « propose puis confirme » introduit en 039 : l'opérateur
--  propose, le directeur confirme — jamais de suppression directe par
--  l'opérateur pour ces dossiers.

CREATE TABLE commission_item_deletion_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES commission_items(id),
  motif           TEXT NOT NULL,
  status          change_status NOT NULL DEFAULT 'en_attente',

  requested_by    UUID NOT NULL REFERENCES users(id),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,

  CONSTRAINT no_self_decision_suppression_item CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX idx_commission_item_deletion_requests_status ON commission_item_deletion_requests(status, requested_at DESC);

-- Une seule demande en attente à la fois par point d'ordre du jour.
CREATE UNIQUE INDEX idx_commission_item_deletion_requests_pending
  ON commission_item_deletion_requests(item_id)
  WHERE status = 'en_attente';

ALTER TYPE commission_item_status ADD VALUE IF NOT EXISTS 'annule';

CREATE TABLE commission_item_deletion_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type         commission_item_type NOT NULL,
  titre             TEXT NOT NULL,
  client_name       TEXT,
  motif             TEXT NOT NULL,
  deleted_by        UUID NOT NULL REFERENCES users(id),
  deleted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_status   TEXT NOT NULL
);
