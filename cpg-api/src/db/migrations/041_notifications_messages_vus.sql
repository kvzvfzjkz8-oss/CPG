-- ═══════════════════════════════════════════════════════════════════
--  041 — Suivi de dernière lecture de la messagerie interne, pour les
--         notifications de connexion (tâches + messages en attente).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS messages_internes_vus_at TIMESTAMPTZ;
