-- ═══════════════════════════════════════════════════════════════════
--  012 — Ajout du rôle Caissier
-- ═══════════════════════════════════════════════════════════════════
--
--  Isolé dans son propre fichier pour la même raison que 002 :
--  ALTER TYPE ... ADD VALUE ne peut pas partager une transaction avec
--  d'autres opérations DDL, ni avec l'utilisation de la valeur ajoutée.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'caissier';
