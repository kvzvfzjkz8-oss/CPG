-- ═══════════════════════════════════════════════════════════════════
--  022 — La caisse principale finance le déblocage des crédits
-- ═══════════════════════════════════════════════════════════════════
--
--  Isolé dans son propre fichier pour la même raison que 002, 012 et
--  020 : ALTER TYPE ... ADD VALUE ne peut pas partager une transaction
--  avec d'autres opérations DDL, ni avec l'utilisation de la valeur
--  ajoutée.

ALTER TYPE caisse_principale_mouvement_type ADD VALUE IF NOT EXISTS 'deblocage_credit';
