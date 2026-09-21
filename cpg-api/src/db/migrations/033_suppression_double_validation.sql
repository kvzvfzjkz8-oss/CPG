-- ═══════════════════════════════════════════════════════════════════
--  033 — Suppression d'un crédit en attente de double validation,
--         par l'opérateur — avec rapport au directeur
-- ═══════════════════════════════════════════════════════════════════
--
--  À ce stade (valide_commission), aucun fonds n'a encore été
--  débloqué — la suppression n'a donc rien à extourner, juste à
--  marquer le dossier 'annule'. Chaque suppression par un opérateur
--  génère un rapport dédié pour le directeur, avec le nom de
--  l'opérateur, la date, et la référence du crédit supprimé.

CREATE TABLE credit_deletion_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_reference  TEXT NOT NULL,
  client_name       TEXT NOT NULL,
  motif             TEXT NOT NULL,
  deleted_by        UUID NOT NULL REFERENCES users(id),
  deleted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by       UUID REFERENCES users(id),
  archived_at       TIMESTAMPTZ
);

CREATE INDEX idx_credit_deletion_reports_archived ON credit_deletion_reports(archived_at);
