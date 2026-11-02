-- ═══════════════════════════════════════════════════════════════════
--  UN FRAIS MENSUEL, UNE SEULE FOIS PAR MOIS — QUEL QUE SOIT LE BARÈME
-- ═══════════════════════════════════════════════════════════════════
--
-- « Assure-toi que les prélèvements ne passeront pas deux fois. »
--
-- Un garde-fou existait déjà : un index unique sur
-- (fee_version_id, account_id, period_start, period_end). Il protège le
-- prélèvement manuel du 2 novembre contre la tâche planifiée du 25 —
-- même barème, même mois civil, donc refus.
--
-- Mais il porte sur la VERSION du barème, pas sur le barème lui-même.
-- FRAIS_TENUE en compte déjà deux (1 000 F jusqu'au 08/09/2026, puis
-- 6 500 F). Si la direction révise le tarif en cours de mois, la
-- nouvelle version porte un autre identifiant : l'index ne reconnaît
-- plus la ligne déjà posée, et les 196 comptes sont facturés une
-- seconde fois. C'est précisément l'accident du 14/10/2026, où
-- 189 agents ont payé deux fois.
--
-- On ajoute donc l'identifiant du barème (la définition, pas la
-- version) et un index unique dessus.

ALTER TABLE applied_fees
  ADD COLUMN IF NOT EXISTS fee_id UUID REFERENCES fee_definitions(id);

UPDATE applied_fees af
SET fee_id = fv.fee_id
FROM fee_versions fv
WHERE fv.id = af.fee_version_id AND af.fee_id IS NULL;

-- Le remplissage est confié à un trigger et non aux appelants. Quatre
-- endroits insèrent dans applied_fees aujourd'hui (frais de tenue,
-- agios, frais déclenchés, rattrapage ponctuel) et un cinquième
-- s'ajoutera un jour : une colonne à remplir à la main est une
-- invariance qu'on finit par oublier, et l'oubli serait silencieux —
-- fee_id à NULL, index unique inopérant, double facturation.
CREATE OR REPLACE FUNCTION applied_fees_remplir_fee_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fee_id IS NULL THEN
    SELECT fv.fee_id INTO NEW.fee_id
    FROM fee_versions fv WHERE fv.id = NEW.fee_version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_applied_fees_fee_id ON applied_fees;
CREATE TRIGGER trg_applied_fees_fee_id
  BEFORE INSERT OR UPDATE OF fee_version_id ON applied_fees
  FOR EACH ROW EXECUTE FUNCTION applied_fees_remplir_fee_id();

-- Les frais DÉCLENCHÉS (commission de retrait, de transfert, d'octroi
-- de crédit) n'ont pas de période : ils se prélèvent à chaque
-- opération, autant de fois qu'il y a d'opérations. Postgres traite les
-- NULL comme distincts dans un index unique, donc ces lignes ne sont
-- pas contraintes — ce qui est exactement ce qu'on veut. Seuls les
-- frais périodiques sont protégés.
--
-- Vérifié avant de poser l'index : aucun compte n'est aujourd'hui
-- facturé deux fois sur un même barème et une même période.
CREATE UNIQUE INDEX IF NOT EXISTS idx_applied_fees_un_par_periode
  ON applied_fees (fee_id, account_id, period_start, period_end);

COMMENT ON COLUMN applied_fees.fee_id IS
  'Le barème (définition, pas version). Rempli automatiquement par trigger. '
  'Porte l''unicité « un frais périodique par compte et par période », qui doit '
  'survivre à un changement de tarif en cours de mois.';
