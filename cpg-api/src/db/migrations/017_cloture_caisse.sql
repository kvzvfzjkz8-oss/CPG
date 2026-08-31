-- ═══════════════════════════════════════════════════════════════════
--  017 — Clôture quotidienne de caisse
-- ═══════════════════════════════════════════════════════════════════
--
--  Chaque caisse a un montant de base de 200 000 FCFA. En fin de
--  journée, si le solde dépasse ce montant, la caissière ne peut pas
--  clôturer sans renvoyer l'excédent vers la caisse principale — pas
--  d'argent qui dort dans une caisse individuelle du jour au
--  lendemain. Une seule clôture par jour et par caissière.

ALTER TYPE caisse_operation_type ADD VALUE IF NOT EXISTS 'retour_excedent';
