-- ═══════════════════════════════════════════════════════════════════
--  LA CAISSE NE COMPTE QUE SES ESPÈCES
-- ═══════════════════════════════════════════════════════════════════
--
-- Un retrait servi par Airtel Money part du téléphone de la caissière,
-- pas de son tiroir. Le solde de caisse les décomptait pourtant comme
-- des espèces : au 09/10/2026, la caisse de Ledry Joëlle affichait
-- -1 372 700 F alors qu'il ne manquait réellement que 139 326 F — les
-- 1 233 374 F d'écart étaient 17 retraits Airtel du 17/09 qui n'ont
-- jamais touché son tiroir.
--
-- Un solde de caisse doit répondre à une seule question : combien y
-- a-t-il dans le tiroir, là, maintenant. Il ne compte donc plus que
-- les mouvements en espèces. Les sorties Mobile Money ne disparaissent
-- pas pour autant : elles sont exposées à part, dans leur propre
-- colonne, pour rester vérifiables contre le relevé de l'opérateur.

CREATE OR REPLACE VIEW caisse_soldes AS
SELECT
  caissier_id,
  (
    COALESCE(SUM(CASE
      WHEN type IN ('appro', 'encaissement_client') AND mode_paiement = 'especes'
      THEN montant ELSE 0 END), 0)
    - COALESCE(SUM(CASE
      WHEN type IN ('retrait_client', 'depense', 'retour_excedent') AND mode_paiement = 'especes'
      THEN montant ELSE 0 END), 0)
  )::bigint AS solde,
  COALESCE(SUM(CASE
    WHEN type = 'retrait_client' AND mode_paiement <> 'especes'
    THEN montant ELSE 0 END), 0)::bigint AS sorties_mobile_money
FROM caisse_operations
WHERE statut = 'validee'
GROUP BY caissier_id;
