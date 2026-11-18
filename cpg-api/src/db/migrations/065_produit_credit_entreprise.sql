-- ═══════════════════════════════════════════════════════════════════
--  065 — LE PRODUIT CRÉDIT ENTREPRISE
-- ═══════════════════════════════════════════════════════════════════
--
-- « Fais le produit crédit entreprise jusqu'à 10 millions sur 12
--   mois. » (direction, 18/11/2026)
--
-- Les produits existants ne couvraient pas ce besoin : l'EXPRESS
-- plafonne à 5 000 000 F sur 5 mois, le MICROLONG à 2 500 000 F sur 24
-- mois. Aucun ne permet 10 millions, et aucun ne porte 10 millions sur
-- une durée assez longue pour que la mensualité reste tenable.
--
-- CE QUE CE PRODUIT N'A PAS BESOIN D'ÊTRE
--   Rien dans le logiciel ne réserve un produit à un type de client :
--   un particulier pourrait techniquement demander ce produit, et une
--   entreprise un MICRO_STD. C'est voulu — le comité de crédit arbitre,
--   et une règle rigide l'empêcherait d'accorder un gros dossier à un
--   commerçant en nom propre. Le nom et la description disent à qui il
--   s'adresse ; la commission fait le reste.
--
--   Ce qui distingue réellement une entreprise, c'est son recouvrement
--   (migration 064 pour le type, et la règle du 17/11/2026 : son rythme
--   est l'échéancier, pas le salaire). Le produit n'y change rien.
--
-- EN BROUILLON, COMME LE DÉCOUVERT
--   Le taux ci-dessous est un point de départ, aligné sur le MICROLONG
--   qui est le produit long de la maison. Fixer une tarification et
--   activer un produit appartiennent au directeur seul
--   (catalogue.ajuster_hors_marge, catalogue.activer) : ce n'est pas à
--   une migration de trancher un prix. Il n'apparaîtra donc aux
--   gestionnaires qu'une fois le barème confirmé et le produit activé
--   depuis l'écran Catalogue.

INSERT INTO credit_products (code, name, description, status, nature, created_by)
SELECT
  'ENTREPRISE',
  'Crédit entreprise',
  'Crédit destiné aux comptes d''entreprise. Remboursement par virement mensuel '
  || 'encaissé au guichet : son échéancier ne dépend pas d''un salaire, contrairement '
  || 'aux crédits des agents.',
  'brouillon',
  'credit',
  (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM credit_products WHERE code = 'ENTREPRISE');

INSERT INTO product_versions
  (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
   file_fee_fixed, file_fee_rate, late_penalty_rate, created_by, note)
SELECT
  p.id, 1,
  0.0990,       -- À CONFIRMER : repris du MICROLONG, le produit long de la maison.
  500000,       -- en dessous, les produits existants couvrent déjà le besoin
  10000000,     -- « jusqu'à 10 millions » (direction, 18/11/2026)
  3, 12,        -- « sur 12 mois » ; 3 au minimum, comme le MICRO_STD
  0, 0, 0,      -- les frais de dossier passent par la commission crédit du catalogue
  p.created_by,
  'Barème initial — montants et durée posés par la direction le 18/11/2026, taux à confirmer avant activation.'
FROM credit_products p
WHERE p.code = 'ENTREPRISE'
  AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_id = p.id);
