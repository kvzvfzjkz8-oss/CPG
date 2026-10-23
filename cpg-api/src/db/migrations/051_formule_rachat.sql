-- ═══════════════════════════════════════════════════════════════════
--  LA FORMULE DU RACHAT, DONNÉE PAR LA DIRECTION
-- ═══════════════════════════════════════════════════════════════════
--
-- « Pour la base de calcul c'est simple : capital restant + (35 % de la
--   somme totale des intérêts restants) + pénalité de 5 % du montant de
--   l'intérêt d'une mensualité. »
--
-- La 050 posait deux bases au choix — capital restant, ou reste des
-- mensualités — et une indemnité en mois d'intérêt. La direction a
-- tranché autrement, et mieux : une seule formule à trois termes.
--
--     montant = capital restant
--             + part        × intérêts restants
--             + penalite    × intérêt d'une mensualité
--
-- Cette écriture englobe les deux anciennes bases plutôt que de les
-- remplacer : avec part = 1, on retombe exactement sur « reste des
-- mensualités » ; avec part = 0, sur le capital seul. Le choix de la
-- direction — part = 0,35 — se situe entre les deux, et c'est ce qui
-- évite le double intérêt d'un rachat sans renoncer à toute marge.
--
-- Les deux taux restent des PARAMÈTRES et non des constantes : une
-- décision de tarification se relit et se révise, elle ne se cherche
-- pas dans le code. Versionnés comme le reste : on n'écrase jamais.
--
-- Aucune règle n'existait encore en production (vérifié le 23/10/2026),
-- donc rien à convertir.

ALTER TABLE remboursement_anticipe_regles
  ADD COLUMN IF NOT EXISTS part_interets_restants      NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS penalite_interet_mensualite NUMERIC(5,4);

-- Bornes : une part d'intérêts au-delà de 100 % ferait payer plus que
-- ce que le crédit devait, et une pénalité au-delà d'une mensualité
-- entière n'est plus une pénalité sur « l'intérêt d'une mensualité ».
ALTER TABLE remboursement_anticipe_regles
  DROP CONSTRAINT IF EXISTS remboursement_anticipe_taux_check;
ALTER TABLE remboursement_anticipe_regles
  ADD CONSTRAINT remboursement_anticipe_taux_check CHECK (
    (part_interets_restants      IS NULL OR part_interets_restants      BETWEEN 0 AND 1)
    AND (penalite_interet_mensualite IS NULL OR penalite_interet_mensualite BETWEEN 0 AND 1)
  );

-- `base` et `indemnite_mois` deviennent facultatifs : la formule les
-- remplace. On ne les supprime pas — des règles historiques pourraient
-- les porter, et on ne réécrit pas le passé.
ALTER TABLE remboursement_anticipe_regles
  ALTER COLUMN base DROP NOT NULL;

ALTER TABLE remboursement_anticipe_regles
  DROP CONSTRAINT IF EXISTS remboursement_anticipe_regles_base_check;
ALTER TABLE remboursement_anticipe_regles
  ADD CONSTRAINT remboursement_anticipe_regles_base_check CHECK (
    base IS NULL OR base IN ('capital_restant', 'reste_mensualites')
  );

-- Une règle doit dire comment elle calcule : soit par la formule
-- (les deux taux), soit par l'ancienne base. Jamais ni l'un ni l'autre.
ALTER TABLE remboursement_anticipe_regles
  DROP CONSTRAINT IF EXISTS remboursement_anticipe_methode_check;
ALTER TABLE remboursement_anticipe_regles
  ADD CONSTRAINT remboursement_anticipe_methode_check CHECK (
    part_interets_restants IS NOT NULL OR base IS NOT NULL
  );

COMMENT ON COLUMN remboursement_anticipe_regles.part_interets_restants IS
  'Part des intérêts restants réclamée au client. 0,35 = décision de la direction du 23/10/2026.';
COMMENT ON COLUMN remboursement_anticipe_regles.penalite_interet_mensualite IS
  'Pénalité, en fraction de l''intérêt contenu dans UNE mensualité. 0,05 = décision du 23/10/2026.';
