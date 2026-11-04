-- ═══════════════════════════════════════════════════════════════════
--  CE QUE L'IMPORT DE PAIE ÉCARTE DOIT RESTER
-- ═══════════════════════════════════════════════════════════════════
--
-- « Corrige les lignes rejetées à l'import de paie. »
--
-- Le 3 novembre 2026, QSR a payé 39 agents sur 44. Impossible de dire
-- pourquoi les 5 autres ne l'ont pas été : l'import calculait bien ses
-- rejets, avec leur motif, mais les affichait à l'écran et les
-- oubliait. Le journal d'audit ne gardait que « 39 crédités,
-- 11 618 500 F ». L'opératrice avait vu la liste à 10 h 17, puis
-- l'information avait disparu.
--
-- Une ligne écartée est pourtant un agent qui n'a pas été payé. C'est
-- exactement ce qu'il faut pouvoir relire : un nom mal orthographié sur
-- le fichier de l'employeur, un homonyme que le logiciel refuse de
-- deviner, un compte inexistant.
--
-- On garde donc l'identifiant tel qu'il figurait sur le fichier — c'est
-- lui qu'on comparera au fichier de l'employeur — le montant demandé,
-- le motif du rejet, et de quel import il provient.
CREATE TABLE IF NOT EXISTS payroll_import_rejects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La référence de l'import, construite comme celle des écritures de
  -- salaire (employeur + période) : elle relie les lignes écartées aux
  -- lignes créditées du même lot.
  reference     TEXT NOT NULL,
  employeur     TEXT NOT NULL,
  periode       TEXT NOT NULL,

  -- Tel quel, sans normalisation : un « MBA METENG Ulrik » mal
  -- orthographié ne se retrouve qu'en le lisant tel qu'il a été envoyé.
  identifiant   TEXT NOT NULL,
  montant       BIGINT,

  -- montant_invalide · nom_ambigu · client_introuvable · deja_credite_ce_mois
  motif         TEXT NOT NULL,

  importe_par   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_rejects_reference
  ON payroll_import_rejects (reference, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_rejects_periode
  ON payroll_import_rejects (periode, employeur);

COMMENT ON TABLE payroll_import_rejects IS
  'Lignes de paie ecartees a l''import, avec leur motif. Sans elles, un agent non '
  'paye reste inexplicable des que l''ecran est ferme.';

-- Aucune reprise du passe : les rejets des imports deja faits sont
-- perdus, personne ne les a enregistres. Le premier import a nourrir
-- cette table sera le prochain.
