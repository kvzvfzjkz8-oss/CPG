-- ─────────────────────────────────────────────────────────────────────
--  ANNULATION DE TRANSACTIONS ET CORRECTION D'ÉCHÉANCES
-- ─────────────────────────────────────────────────────────────────────
--
-- L'opérateur vérifie les opérations que le logiciel effectue seul
-- (paie créditée, agios et échéances prélevés automatiquement) et peut
-- corriger une erreur : annuler une transaction, ou ajuster une
-- échéance pas encore prélevée.
--
-- Annuler NE SUPPRIME JAMAIS une écriture : le journal reste en ajout
-- seul, comme partout ailleurs dans ce schéma. Annuler une transaction
-- crée une écriture inverse qui la neutralise, et reversed_entry_id
-- garde le lien entre les deux — indispensable pour reconstituer
-- l'historique et empêcher d'annuler deux fois la même chose.

ALTER TYPE entry_type ADD VALUE 'annulation';
