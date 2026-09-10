-- ═══════════════════════════════════════════════════════════════════
--  025 — Messages ciblés, en plus du canal d'équipe
-- ═══════════════════════════════════════════════════════════════════
--
--  recipient_id NULL = message à toute l'équipe (comportement
--  d'origine, inchangé). recipient_id renseigné = message direct,
--  visible seulement par l'expéditeur et le destinataire.

ALTER TABLE staff_messages ADD COLUMN recipient_id UUID REFERENCES users(id);

CREATE INDEX idx_staff_messages_thread ON staff_messages(sender_id, recipient_id, created_at);
