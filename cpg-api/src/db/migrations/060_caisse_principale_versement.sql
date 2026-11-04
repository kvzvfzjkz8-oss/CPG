-- ═══════════════════════════════════════════════════════════════════
--  LE SOLDE DE LA CAISSE PRINCIPALE TIENT COMPTE DES VERSEMENTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Sans cette reprise de la vue, un versement ponctuel serait écrit dans
-- caisse_principale_mouvements mais ne diminuerait pas le solde : le
-- directeur verrait un fonds qui n'existe plus, et autoriserait des
-- décaissements sur de l'argent déjà promis.
--
-- `versement_client` rejoint donc les sorties, aux côtés des transferts
-- vers une caissière et des déblocages de crédit.
CREATE OR REPLACE VIEW caisse_principale_solde AS
SELECT (
  COALESCE(SUM(CASE
    WHEN type IN ('alimentation', 'alimentation_depuis_coffre', 'recuperation_client')
    THEN montant ELSE 0 END), 0)
  - COALESCE(SUM(CASE
    WHEN type IN ('transfert_vers_caissiere', 'deblocage_credit', 'versement_client')
    THEN montant ELSE 0 END), 0)
)::bigint AS solde
FROM caisse_principale_mouvements;
