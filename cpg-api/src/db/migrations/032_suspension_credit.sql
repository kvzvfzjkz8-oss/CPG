-- ═══════════════════════════════════════════════════════════════════
--  032 — Suspension temporaire d'un crédit actif
-- ═══════════════════════════════════════════════════════════════════
--
--  Avant d'en arriver à la suppression définitive (031, directeur
--  seul), le gestionnaire doit pouvoir mettre un crédit suspect
--  (doublon probable, erreur de saisie) de côté le temps de vérifier
--  — réversible, contrairement à la suppression. Rien n'est extourné
--  ici : c'est juste une pause, pas une opération financière.

ALTER TYPE credit_status ADD VALUE IF NOT EXISTS 'suspendu';

ALTER TABLE credit_requests ADD COLUMN suspended_by UUID REFERENCES users(id);
ALTER TABLE credit_requests ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE credit_requests ADD COLUMN suspend_motif TEXT;
