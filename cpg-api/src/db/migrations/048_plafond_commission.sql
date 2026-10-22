-- ═══════════════════════════════════════════════════════════════════
--  PLAFOND D'UNE SÉANCE DE COMMISSION
-- ═══════════════════════════════════════════════════════════════════
--
-- « Chaque commission doit avoir un montant plafonné donné par le
--   directeur. Un montant qui ne doit pas être dépassé. Il s'agit d'un
--   montant fictif qui après la commission sera payé par la caisse.
--   Ainsi à chaque dépôt de dossier le solde du montant donné par le
--   directeur est mis à jour naturellement. Ce montant peut être
--   dépassé tant que la commission n'a pas été tenue, mais durant la
--   tenue de la séance les noms et les montants qui vont être validés
--   ne doivent pas dépasser ce montant. »
--
-- Deux régimes, et c'est toute la subtilité :
--
--   • AU DÉPÔT — informatif. Le gestionnaire peut déposer au-delà de
--     l'enveloppe ; il voit le reste fondre et devenir négatif, mais
--     rien ne le bloque. Déposer n'engage aucun franc : c'est en
--     séance qu'on décide.
--
--   • EN SÉANCE — bloquant. La somme des dossiers marqués « validé »
--     ne peut pas dépasser le plafond. Le dépassement est refusé avec
--     le montant exact de l'excédent, et la séance n'est pas tenue.
--
-- Ce qui dépasse n'est pas perdu : le dossier se retire de la file
-- (withdrawFromCommission) et revient à « valide_niveau1 », prêt pour
-- une séance suivante. Aucun bon dossier n'a donc à être rejeté faute
-- d'enveloppe.
--
-- Le plafond reste nullable : les séances déjà tenues n'en avaient pas,
-- et on ne réécrit pas le passé. Une séance sans plafond ne bloque
-- rien — l'ancien comportement, pour ne pas figer une séance déjà
-- planifiée tant que la direction ne lui a pas fixé d'enveloppe.

ALTER TABLE commission_sessions
  ADD COLUMN IF NOT EXISTS plafond        BIGINT,
  ADD COLUMN IF NOT EXISTS plafond_par    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS plafond_le     TIMESTAMPTZ;

ALTER TABLE commission_sessions
  DROP CONSTRAINT IF EXISTS commission_sessions_plafond_check;

-- Un plafond à zéro ou négatif n'a pas de sens : il interdirait tout.
-- Pour « pas d'enveloppe fixée », la valeur est NULL, pas 0.
ALTER TABLE commission_sessions
  ADD CONSTRAINT commission_sessions_plafond_check
  CHECK (plafond IS NULL OR plafond > 0);

-- ─── Suivi de l'enveloppe ──────────────────────────────────────────
--
-- Vue unique pour les trois chiffres que la direction et le
-- gestionnaire doivent voir en permanence : ce qui est autorisé, ce qui
-- est déposé, ce qui reste. Calculée et non stockée, comme les soldes
-- de compte : impossible qu'elle dérive de la réalité des dépôts.
--
-- Seuls les DOSSIERS DE CRÉDIT consomment l'enveloppe. Les points
-- « difficulté » et « demande exceptionnelle » passent en commission
-- mais ne décaissent rien par eux-mêmes : les compter fausserait le
-- rapprochement avec ce que la caisse paiera réellement.
CREATE OR REPLACE VIEW commission_enveloppes AS
SELECT
  cs.id AS session_id,
  cs.plafond,
  COALESCE(SUM(c.amount) FILTER (
    WHERE c.status = 'en_attente_commission'
  ), 0)::bigint AS depose,
  COALESCE(SUM(c.amount) FILTER (
    WHERE c.status IN ('valide_commission', 'valide_double', 'approuve')
  ), 0)::bigint AS valide,
  CASE
    WHEN cs.plafond IS NULL THEN NULL
    ELSE cs.plafond - COALESCE(SUM(c.amount) FILTER (
      WHERE c.status = 'en_attente_commission'
    ), 0)
  END::bigint AS reste,
  count(c.id) FILTER (WHERE c.status = 'en_attente_commission')::int AS dossiers_deposes
FROM commission_sessions cs
LEFT JOIN credit_requests c ON c.commission_session_id = cs.id
GROUP BY cs.id, cs.plafond;
