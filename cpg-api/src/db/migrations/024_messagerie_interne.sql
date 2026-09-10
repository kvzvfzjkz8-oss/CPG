-- ═══════════════════════════════════════════════════════════════════
--  024 — Messagerie interne entre employés
-- ═══════════════════════════════════════════════════════════════════
--
--  Un seul canal partagé, pas de conversations séparées : tout le
--  personnel (opérateur, gestionnaire, directeur, caissier) y écrit
--  et y lit. Volontairement plus simple que la messagerie
--  client-conseiller, qui reste un canal distinct et privé.

CREATE TABLE staff_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_messages_created ON staff_messages(created_at DESC);
