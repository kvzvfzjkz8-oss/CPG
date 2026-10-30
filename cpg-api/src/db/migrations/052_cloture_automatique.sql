-- ═══════════════════════════════════════════════════════════════════
--  LE RENVOI DE 15H30 N'EST PLUS LAISSÉ À LA BONNE VOLONTÉ
-- ═══════════════════════════════════════════════════════════════════
--
-- « Il faut que le renvoi de l'argent à partir de 15H30 soit assez
--   strict. Je constate qu'il y a des fois où l'argent reste encore
--   dans la caisse. »
--
-- Constat au 27/10/2026 : sur 23 journées d'activité, 15 n'ont jamais
-- été clôturées. L'argent dormait au guichet — jusqu'à 26 174 607 F le
-- 07/10. La clôture était un bouton : si personne ne cliquait, rien ne
-- repartait.
--
-- Désormais une tâche planifiée clôture à 15h30 (heure de Libreville)
-- toute caisse qui ne l'a pas été, et renvoie l'excédent au-delà du
-- fonds de caisse. Une seconde passe le soir rattrape ce qui est entré
-- après. Le bouton reste : une caissière qui clôture elle-même à 15h20
-- garde la main, et c'est préférable.
--
-- Cette colonne dit qui a clôturé : elle, ou le logiciel à sa place.
-- Sans elle, le directeur ne pourrait pas distinguer une caisse tenue
-- d'une caisse rattrapée, et le rappel à l'ordre n'aurait pas de base.
ALTER TABLE caisse_clotures
  ADD COLUMN IF NOT EXISTS automatique BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN caisse_clotures.automatique IS
  'true = clôture faite par la tâche planifiée de 15h30, la caissière ne l''avait pas faite.';

-- Les 10 clôtures existantes ont toutes été faites à la main : le
-- défaut false les décrit correctement, rien à reprendre.
