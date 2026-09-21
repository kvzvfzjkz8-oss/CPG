-- ═══════════════════════════════════════════════════════════════════
--  028 — Traçabilité de la modification des utilisateurs
-- ═══════════════════════════════════════════════════════════════════
--
--  created_by existe déjà (migration 013). Il manquait updated_by,
--  pour savoir aussi qui a modifié une fiche après sa création.

ALTER TABLE users ADD COLUMN updated_by UUID REFERENCES users(id);
