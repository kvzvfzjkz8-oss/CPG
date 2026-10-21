-- ═══════════════════════════════════════════════════════════════════
--  RETRAIT PONCTUEL — colonnes et soldes
-- ═══════════════════════════════════════════════════════════════════
--
-- Suite de la 044. Un retrait ponctuel est demandé par l'opérateur,
-- validé par le directeur, et va soit à CPG soit au client.
--
-- Trois précautions :
--
--   • caissier_id devient facultatif. Une récupération par CPG ne
--     passe par aucun guichet : y inscrire l'opérateur ferait
--     apparaître une caisse fantôme à son nom dans caisse_soldes.
--     Les vues excluent donc explicitement les lignes sans caissier.
--
--   • demandeur_id garde qui a demandé. Le champ caissier_id répondait
--     jusqu'ici aux deux questions à la fois ; elles se séparent.
--
--   • motif devient obligatoire pour ce type d'opération. Les
--     écritures « Ces fonds ne sont pas justifiés » de septembre nous
--     ont coûté des jours d'enquête faute d'avoir dit pourquoi.

ALTER TABLE caisse_operations
  ALTER COLUMN caissier_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS demandeur_id UUID REFERENCES users(id);

ALTER TABLE caisse_operations
  DROP CONSTRAINT IF EXISTS caisse_operations_retrait_ponctuel_check;

ALTER TABLE caisse_operations
  ADD CONSTRAINT caisse_operations_retrait_ponctuel_check CHECK (
    type <> 'retrait_ponctuel' OR (
      destination IN ('cpg', 'client')
      AND client_id IS NOT NULL
      AND motif IS NOT NULL AND btrim(motif) <> ''
      -- Une remise au client sort des espèces : il faut savoir de
      -- quelle caisse. Une récupération par CPG n'en touche aucune.
      AND ((destination = 'client' AND caissier_id IS NOT NULL)
           OR (destination = 'cpg' AND caissier_id IS NULL))
    )
  );

-- Le solde d'une caissière ne compte que ses espèces (voir 043), et
-- désormais seulement les lignes qui lui sont rattachées. Un retrait
-- ponctuel remis au client sort bien de son tiroir.
CREATE OR REPLACE VIEW caisse_soldes AS
SELECT
  caissier_id,
  (
    COALESCE(SUM(CASE
      WHEN type IN ('appro', 'encaissement_client') AND mode_paiement = 'especes'
      THEN montant ELSE 0 END), 0)
    - COALESCE(SUM(CASE
      WHEN type IN ('retrait_client', 'depense', 'retour_excedent', 'retrait_ponctuel')
       AND mode_paiement = 'especes'
      THEN montant ELSE 0 END), 0)
  )::bigint AS solde,
  COALESCE(SUM(CASE
    WHEN type = 'retrait_client' AND mode_paiement <> 'especes'
    THEN montant ELSE 0 END), 0)::bigint AS sorties_mobile_money
FROM caisse_operations
WHERE statut = 'validee' AND caissier_id IS NOT NULL
GROUP BY caissier_id;

-- Une récupération sur un client alimente la caisse principale.
CREATE OR REPLACE VIEW caisse_principale_solde AS
SELECT (
  COALESCE(SUM(CASE
    WHEN type IN ('alimentation', 'alimentation_depuis_coffre', 'recuperation_client')
    THEN montant ELSE 0 END), 0)
  - COALESCE(SUM(CASE
    WHEN type IN ('transfert_vers_caissiere', 'deblocage_credit')
    THEN montant ELSE 0 END), 0)
)::bigint AS solde
FROM caisse_principale_mouvements;
