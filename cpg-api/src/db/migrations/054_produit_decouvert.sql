-- ═══════════════════════════════════════════════════════════════════
--  LE PRODUIT DÉCOUVERT
-- ═══════════════════════════════════════════════════════════════════
--
-- Même circuit que les autres crédits — demande, validation niveau 1
-- par l'opérateur, dépôt en commission, double validation, approbation
-- du directeur. Deux différences, et elles sont ici :
--
--   1. À l'approbation, le compte est DÉBITÉ du montant accordé au lieu
--      d'être crédité. Le solde devient négatif : c'est le découvert.
--
--   2. Il n'y a pas d'échéancier. La collecte des échéances ne prélève
--      que si le compte est provisionné ; un découvert laissant le
--      compte négatif par construction, chaque échéance serait tombée
--      « en retard » tous les mois sans jamais se prélever. La
--      récupération se fait d'elle-même : le salaire arrive, le compte
--      remonte, le découvert s'efface. Il passe « soldé » quand le
--      compte repasse à zéro ou au-dessus.
--
-- Les intérêts (décision de la direction du 30/10/2026) : le taux
-- mensuel du produit appliqué chaque mois sur le montant ENCORE à
-- découvert — donc décroissant à mesure que le compte se renfloue.
-- Et les agios de 5 000 F sur solde débiteur sont suspendus tant que
-- le négatif reste dans la limite autorisée : on ne facture pas deux
-- fois le même découvert.

-- La nature distingue les deux familles de produits. Un texte avec
-- contrainte plutôt qu'un enum : une famille de produits se relit, et
-- un enum impose de couper les migrations en deux à chaque ajout.
ALTER TABLE credit_products
  ADD COLUMN IF NOT EXISTS nature TEXT NOT NULL DEFAULT 'credit';

ALTER TABLE credit_products
  DROP CONSTRAINT IF EXISTS credit_products_nature_check;
ALTER TABLE credit_products
  ADD CONSTRAINT credit_products_nature_check CHECK (nature IN ('credit', 'decouvert'));

COMMENT ON COLUMN credit_products.nature IS
  'credit = le compte est crédité au déblocage et remboursé par échéances. '
  'decouvert = le compte est débité, et se renfloue de lui-même (débit autorisé).';

-- Les cinq produits existants sont des crédits : le défaut les décrit
-- correctement, rien à reprendre.

-- Le produit lui-même, en BROUILLON : il n'apparaît pas encore aux
-- gestionnaires. Le barème ci-dessous est un point de départ — fixer un
-- taux et activer un produit appartiennent au directeur seul
-- (catalogue.ajuster_hors_marge, catalogue.activer), et ce n'est pas à
-- une migration de trancher une tarification.
INSERT INTO credit_products (code, name, description, status, nature, created_by)
SELECT
  'DECOUVERT',
  'Découvert autorisé',
  'Débit autorisé sur le compte. Le compte est débité du montant accordé au lieu '
  || 'd''être crédité ; il se renfloue au fil des versements et le découvert est soldé '
  || 'dès que le solde repasse à zéro. Intérêt mensuel sur le montant encore à découvert.',
  'brouillon',
  'decouvert',
  (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM credit_products WHERE code = 'DECOUVERT');

INSERT INTO product_versions
  (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
   file_fee_fixed, file_fee_rate, late_penalty_rate, created_by, note)
SELECT
  p.id, 1,
  0.0500,      -- À CONFIRMER par la direction avant activation.
  10000,       -- montant minimum accordé
  500000,      -- montant maximum accordé
  1, 3,        -- durée autorisée, en mois
  0, 0, 0,     -- les frais de dossier passent par la commission crédit du catalogue
  p.created_by,
  'Barème initial — taux et bornes à confirmer par la direction avant activation.'
FROM credit_products p
WHERE p.code = 'DECOUVERT'
  AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_id = p.id);

-- La vue que lisent le gestionnaire (choix du produit) et le client
-- (catalogue public) doit porter la nature : sans elle, l'écran ne peut
-- pas prévenir qu'un dossier va DÉBITER le compte au lieu de le
-- créditer, et le gestionnaire n'a aucun moyen de le savoir.
CREATE OR REPLACE VIEW current_product_versions AS
-- `nature` est ajoutee EN DERNIERE COLONNE, et pas a sa place logique
-- apres `status` : CREATE OR REPLACE VIEW ne sait qu'ajouter des
-- colonnes a la fin — inserer au milieu renomme les suivantes et
-- Postgres refuse (« cannot change name of view column »).
SELECT p.id AS product_id,
       p.code,
       p.name,
       p.status,
       v.id AS version_id,
       v.version,
       v.monthly_rate,
       v.min_amount,
       v.max_amount,
       v.min_duration,
       v.max_duration,
       v.file_fee_fixed,
       v.file_fee_rate,
       v.late_penalty_rate,
       v.effective_from,
       p.nature
FROM credit_products p
JOIN product_versions v ON v.product_id = p.id AND v.effective_to IS NULL;

-- ═══════════════════════════════════════════════════════════════════
--  JUSQU'OÙ UN COMPTE A LE DROIT D'ÊTRE NÉGATIF
-- ═══════════════════════════════════════════════════════════════════
--
-- « Le compte peut être en négatif, mais le quota autorisé peut faire
--   en sorte que le client puisse toutefois prendre encore malgré son
--   solde négatif. »
--
-- Cette limite est consultée à quatre endroits : le dépôt d'une demande
-- de retrait, sa validation par le directeur, l'écran de la caissière,
-- et le calcul des agios. Quatre requêtes séparées auraient fini par
-- diverger — le logiciel aurait autorisé un retrait puis facturé les
-- agios dessus. D'où une seule définition, ici.
--
-- Deux sources, cumulées :
--
--   • l'AUTORISATION, à partir du jour de l'accord. Elle ne correspond
--     à aucune écriture : l'approbation ouvre un droit à débit, elle ne
--     verse rien. C'est le retrait au guichet qui met le compte en
--     négatif ;
--
--   • ce que le découvert a lui-même CHARGÉ au compte — commission
--     d'octroi, intérêts mensuels — reconnu à la référence du dossier.
--     Sans cette part, l'intérêt du mois sortirait de la limite et
--     déclencherait les agios : l'intérêt se taxerait lui-même.
--
-- Le détail par jour sert aux agios, qui raisonnent sur les soldes
-- journaliers : une autorisation accordée le 29 ne doit pas exonérer
-- le mois entier.
CREATE OR REPLACE VIEW decouverts_autorisations_jour AS
WITH dossiers AS (
  SELECT c.reference, c.amount, c.user_id, a.id AS account_id,
         (c.approved_at AT TIME ZONE 'UTC')::date AS jour
  FROM credit_requests c
  JOIN product_versions pv ON pv.id = c.product_version_id
  JOIN credit_products p ON p.id = pv.product_id
  JOIN accounts a ON a.user_id = c.user_id
  WHERE p.nature = 'decouvert' AND c.status = 'approuve'
),
lignes AS (
  SELECT account_id, user_id, jour, amount AS montant FROM dossiers
  UNION ALL
  SELECT d.account_id, d.user_id,
         (le.created_at AT TIME ZONE 'UTC')::date, -le.amount
  FROM dossiers d
  JOIN ledger_entries le
    ON le.account_id = d.account_id AND le.reference = d.reference AND le.amount < 0
)
SELECT account_id, user_id, jour, SUM(montant)::bigint AS montant
FROM lignes
GROUP BY account_id, user_id, jour;

COMMENT ON VIEW decouverts_autorisations_jour IS
  'Limite de négatif autorisée par compte et par jour : autorisations de découvert '
  'en cours, plus ce qu''elles ont chargé au compte. Source unique pour le guichet, '
  'sa validation, l''écran caissière et les agios.';
