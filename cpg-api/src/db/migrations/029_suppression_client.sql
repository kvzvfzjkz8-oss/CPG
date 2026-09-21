-- ═══════════════════════════════════════════════════════════════════
--  029 — Suppression sécurisée d'un client par le gestionnaire
-- ═══════════════════════════════════════════════════════════════════
--
--  Une vraie suppression SQL est trop risquée : 49 tables référencent
--  users(id) (crédits, transactions, journal d'audit...). On désactive
--  plutôt le compte (nouveau statut 'supprime', exclu des listes
--  actives) et on garde un rapport dédié pour le directeur, qui peut
--  l'archiver une fois pris connaissance.

ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'supprime';

CREATE TABLE client_deletion_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES users(id),
  client_name    TEXT NOT NULL,       -- gardé même si le nom change plus tard
  client_number  TEXT,
  motif          TEXT NOT NULL,
  deleted_by     UUID NOT NULL REFERENCES users(id),
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by    UUID REFERENCES users(id),
  archived_at    TIMESTAMPTZ
);

CREATE INDEX idx_deletion_reports_archived ON client_deletion_reports(archived_at);
