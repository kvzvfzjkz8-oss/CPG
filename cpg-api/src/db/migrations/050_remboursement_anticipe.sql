-- ═══════════════════════════════════════════════════════════════════
--  REMBOURSEMENT ANTICIPÉ D'UN CRÉDIT
-- ═══════════════════════════════════════════════════════════════════
--
-- « Possibilité de rachat d'un crédit. Il faut regarder comment on peut
--   le faire. »
--
-- Le rachat (un nouveau crédit qui solde l'ancien) se pose sur une
-- brique plus simple : solder un crédit avant son terme. C'est elle
-- qu'on installe ici, et elle est utile seule — un agent qui veut
-- solder avec son propre argent n'avait aucun moyen de le faire.
--
-- ─── POURQUOI UNE RÈGLE CONFIGURABLE ET NON UN CALCUL FIGÉ ─────────
--
-- Les intérêts de CPG sont en INTÉRÊT SIMPLE, calculés d'avance sur
-- toute la durée : total = capital × (1 + taux × durée). Chaque
-- mensualité porte donc une part d'intérêt fixe, y compris pour des
-- mois que le client n'utilisera pas s'il solde en avance.
--
-- Deux lectures s'opposent, et l'écart n'est pas théorique : au
-- 23/10/2026, sur 97 crédits en cours, le reste des mensualités
-- totalise 26 942 909 F quand le capital restant n'est que de
-- 18 269 268 F. Huit millions six cent mille francs d'écart.
--
--   • « reste_mensualites » : le client paie tout ce qui reste dû.
--     Le plus favorable à CPG. Mais dans un RACHAT, l'agent paie alors
--     des intérêts sur des mois non utilisés ET des intérêts sur le
--     nouveau crédit pour la même période : il paie deux fois. Un agent
--     qui s'en aperçoit ne refait jamais de rachat.
--
--   • « capital_restant » : le client ne paie que le capital qu'il
--     doit encore, plus une indemnité en mois d'intérêt. C'est la
--     pratique courante, et elle évite le double intérêt.
--
-- Ce choix engage l'établissement sur des années et appartient à la
-- direction, pas au code. La règle est donc posée ici, versionnée
-- comme les barèmes : on n'écrase jamais, on ajoute une version. Un
-- client contestant un solde doit pouvoir se voir opposer la règle en
-- vigueur ce jour-là.
--
-- AUCUNE RÈGLE N'EST CRÉÉE PAR DÉFAUT. Tant que la direction n'en a
-- pas activé une, aucun remboursement anticipé n'est possible et le
-- logiciel le dit clairement. Choisir à sa place serait décider de
-- 8 673 641 F sans mandat.

CREATE TABLE IF NOT EXISTS remboursement_anticipe_regles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sur quoi porte le solde : le capital encore dû, ou la totalité des
  -- mensualités restantes.
  base            TEXT NOT NULL CHECK (base IN ('capital_restant', 'reste_mensualites')),

  -- Indemnité de remboursement anticipé, exprimée en MOIS d'intérêt
  -- sur le capital restant. 0 = aucune indemnité. Bornée à 6 : au-delà
  -- l'indemnité dépasserait l'économie d'intérêt et le solde anticipé
  -- coûterait plus cher que de laisser courir.
  indemnite_mois  INT NOT NULL DEFAULT 0 CHECK (indemnite_mois BETWEEN 0 AND 6),

  -- Nombre minimal d'échéances déjà payées avant qu'un solde anticipé
  -- soit permis. Évite qu'un crédit soit soldé le mois de son octroi.
  echeances_minimum INT NOT NULL DEFAULT 1 CHECK (echeances_minimum >= 0),

  note            TEXT,

  -- Une indemnité par-dessus « reste_mensualites » serait un double
  -- compte : cette base contient déjà la totalité des intérêts, y
  -- compris ceux des mois non utilisés. L'indemnité n'a de sens que
  -- pour compenser les intérêts auxquels CPG renonce.
  CONSTRAINT remboursement_anticipe_indemnite_coherente CHECK (
    base = 'capital_restant' OR indemnite_mois = 0
  ),
  definie_par     UUID NOT NULL REFERENCES users(id),
  definie_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = version en vigueur. Une seule à la fois (index ci-dessous).
  remplacee_le    TIMESTAMPTZ
);

-- Une seule règle en vigueur à la fois : la précédente est datée avant
-- qu'une nouvelle soit posée.
CREATE UNIQUE INDEX IF NOT EXISTS idx_remboursement_anticipe_en_vigueur
  ON remboursement_anticipe_regles ((remplacee_le IS NULL))
  WHERE remplacee_le IS NULL;

-- ─── Traçabilité sur le crédit soldé ───────────────────────────────
--
-- Un crédit soldé par anticipation passe à « solde » comme un crédit
-- arrivé à son terme. Sans ces colonnes, les deux deviendraient
-- indistinguables : impossible de savoir si le client a payé jusqu'au
-- bout ou s'il a soldé en avance, ni à quelles conditions.
ALTER TABLE credit_requests
  ADD COLUMN IF NOT EXISTS solde_par_anticipation_le    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS solde_par_anticipation_par   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS solde_par_anticipation_montant BIGINT,
  ADD COLUMN IF NOT EXISTS solde_par_anticipation_regle UUID REFERENCES remboursement_anticipe_regles(id),
  -- Renseigné quand le solde a été financé par un AUTRE crédit : c'est
  -- la définition du rachat.
  ADD COLUMN IF NOT EXISTS rachete_par_credit_id        UUID REFERENCES credit_requests(id);

COMMENT ON COLUMN credit_requests.solde_par_anticipation_montant IS
  'Somme réellement prélevée pour solder, selon la règle en vigueur ce jour-là.';
COMMENT ON COLUMN credit_requests.rachete_par_credit_id IS
  'Le crédit qui a financé ce solde — NULL si le client a soldé avec son propre argent.';
