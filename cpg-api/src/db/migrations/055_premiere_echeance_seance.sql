-- ═══════════════════════════════════════════════════════════════════
--  LA DATE DU PREMIER PRÉLÈVEMENT, DÉCIDÉE EN SÉANCE
-- ═══════════════════════════════════════════════════════════════════
--
-- « Les dossiers qui vont être validés demain seront prélevés le 03 du
--   mois de novembre, il faudrait que tu le gardes en mémoire. »
--   (direction, 22/10/2026)
--
-- Le logiciel posait la première échéance à la date d'approbation
-- + 1 mois : les 25 dossiers validés le 23/10 ont donc reçu une
-- première échéance au 23/11, jamais au 3. Il a fallu les redater à la
-- main, dossier par dossier, quatre jours avant le prélèvement.
--
-- La décision porte sur la SÉANCE, pas sur chaque dossier : le
-- directeur fixe une date pour tout ce qui sera validé ce jour-là,
-- comme il fixe l'enveloppe. La colonne est donc ici et pas sur
-- credit_requests.
--
-- À l'approbation finale, si la séance d'origine porte une date, elle
-- commande l'échéancier ; sinon le comportement d'avant s'applique.
ALTER TABLE commission_sessions
  ADD COLUMN IF NOT EXISTS premiere_echeance DATE,
  ADD COLUMN IF NOT EXISTS premiere_echeance_par UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS premiere_echeance_le TIMESTAMPTZ;

COMMENT ON COLUMN commission_sessions.premiere_echeance IS
  'Date du premier prélèvement pour les dossiers validés en cette séance. '
  'NULL = comportement par défaut (approbation + 1 mois).';

-- Les séances passées n'en portent pas : leurs dossiers ont déjà leur
-- échéancier, et on ne réécrit pas le passé. La séance du 23/10 reçoit
-- malgré tout la date effectivement appliquée, pour que la trace de la
-- décision survive au script qui l'a exécutée.
UPDATE commission_sessions
SET premiere_echeance = DATE '2026-11-03'
WHERE held_at::date = DATE '2026-10-23' AND premiere_echeance IS NULL;
