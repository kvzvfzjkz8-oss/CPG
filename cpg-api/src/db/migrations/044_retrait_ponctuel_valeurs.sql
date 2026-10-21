-- ═══════════════════════════════════════════════════════════════════
--  RETRAIT PONCTUEL — nouvelles valeurs d'énumération
-- ═══════════════════════════════════════════════════════════════════
--
-- L'opérateur doit pouvoir débiter ponctuellement le compte d'un
-- client, avec validation du directeur. Deux destinations possibles :
-- la somme revient à CPG (trop-perçu, pénalité, correction), ou elle
-- est remise au client au guichet.
--
-- Cette migration n'ajoute QUE les valeurs d'énumération. PostgreSQL
-- refuse qu'une valeur ajoutée par ALTER TYPE soit utilisée dans la
-- même transaction, et le lanceur de migrations envoie chaque fichier
-- d'un bloc : les vues qui s'en servent sont donc dans la 045.

ALTER TYPE caisse_operation_type ADD VALUE IF NOT EXISTS 'retrait_ponctuel';

-- Une récupération entre dans la caisse principale de l'entreprise :
-- l'argent quitte le compte du client et rejoint les fonds de CPG.
ALTER TYPE caisse_principale_mouvement_type ADD VALUE IF NOT EXISTS 'recuperation_client';
