-- ═══════════════════════════════════════════════════════════════════
--  027 — Justificatif sur les opérations de caisse
-- ═══════════════════════════════════════════════════════════════════
--
--  La caissière indique, au moment de la demande, si elle a un
--  justificatif pour l'opération, et peut y joindre une image ou un
--  fichier. Stocké directement en base (bytea) plutôt que sur le
--  disque du serveur : Railway efface le système de fichiers à
--  chaque redéploiement, un fichier qui y vivrait serait perdu au
--  premier déploiement suivant.

ALTER TABLE caisse_operations ADD COLUMN justifie BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE caisse_operations ADD COLUMN justificatif_nom TEXT;
ALTER TABLE caisse_operations ADD COLUMN justificatif_type TEXT;
ALTER TABLE caisse_operations ADD COLUMN justificatif_donnees BYTEA;
