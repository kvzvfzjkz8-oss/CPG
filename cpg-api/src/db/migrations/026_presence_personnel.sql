-- ═══════════════════════════════════════════════════════════════════
--  026 — Présence en ligne du personnel
-- ═══════════════════════════════════════════════════════════════════
--
--  Mise à jour à chaque requête authentifiée (middleware), pas de
--  websocket : « en ligne » se déduit simplement d'une activité dans
--  les deux dernières minutes, suffisant pour un indicateur de
--  présence sur la messagerie interne.

ALTER TABLE users ADD COLUMN last_active_at TIMESTAMPTZ;
