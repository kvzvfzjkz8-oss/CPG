-- ═══════════════════════════════════════════════════════════════════
--  014 — Caisse principale, dépenses et réceptions d'espèces
-- ═══════════════════════════════════════════════════════════════════
--
--  Ajoute la pièce manquante : une caisse centrale de l'entreprise,
--  distincte des caisses individuelles. Le directeur l'alimente (retrait
--  bancaire apporté au bureau, apport personnel...), et c'est SEULEMENT
--  depuis cette réserve centrale qu'un réapprovisionnement de caissière
--  peut être validé — impossible de transférer plus que ce que la
--  caisse principale contient réellement.
--
--  Deux nouveaux types d'opération pour la caissière :
--    - depense            : sortie de fonds pour un besoin de
--                            fonctionnement courant (pas un client) —
--                            soumis à validation du directeur, comme
--                            un retrait client.
--    - encaissement_client : un client remet des espèces au guichet
--                            pour les déposer sur son compte — la
--                            caissière encaisse, le compte du client
--                            est crédité, et sa caisse augmente
--                            d'autant. Contrairement aux sorties de
--                            fonds, ça s'applique immédiatement : le
--                            risque n'est pas le même (de l'argent qui
--                            RENTRE, adossé à des espèces réellement
--                            en main), et faire attendre un dépôt
--                            client au guichet n'a pas de sens en
--                            pratique.

ALTER TYPE caisse_operation_type ADD VALUE IF NOT EXISTS 'depense';
ALTER TYPE caisse_operation_type ADD VALUE IF NOT EXISTS 'encaissement_client';
