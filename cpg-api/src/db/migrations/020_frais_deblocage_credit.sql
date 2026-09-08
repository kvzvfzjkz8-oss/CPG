-- ═══════════════════════════════════════════════════════════════════
--  020 — Déclencheur de frais : déblocage de crédit
-- ═══════════════════════════════════════════════════════════════════
--
--  Isolé dans son propre fichier pour la même raison que 002 et 012 :
--  ALTER TYPE ... ADD VALUE ne peut pas partager une transaction avec
--  d'autres opérations DDL, ni avec l'utilisation de la valeur ajoutée.

ALTER TYPE fee_trigger ADD VALUE IF NOT EXISTS 'deblocage_credit';
