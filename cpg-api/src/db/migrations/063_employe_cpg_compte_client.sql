-- ═══════════════════════════════════════════════════════════════════
--  063 — LES EMPLOYÉS CPG TOUCHENT LEUR SALAIRE SUR LE LOGICIEL
-- ═══════════════════════════════════════════════════════════════════
--
-- « Il faut que tu puisses permettre aux employés de la banque d'ouvrir
--   un compte et de toucher leur salaire directement sur le logiciel.
--   Création comme tout client, employeur CPG. » (direction, 11/11/2026)
--
-- Les rôles d'agent n'ont ni compte ni numéro client : seul le rôle
-- `client` en reçoit. Un employé qui veut être payé sur le logiciel a
-- donc besoin d'une SECONDE FICHE, de rôle client — ce que la direction
-- a arbitré le 13/11/2026 : « deux fiches par employé ».
--
-- Une seule chose l'empêchait : `users_phone_key`, l'unicité du
-- téléphone sur TOUTE la table. Les douze agents ont leur numéro sur
-- leur fiche d'agent, et ne pouvaient donc pas le réutiliser sur leur
-- fiche client. Leur demander un second numéro aurait été absurde.
--
-- POURQUOI C'EST SANS DANGER
--   Les agents ne s'authentifient JAMAIS par téléphone :
--     • /auth/connexion-agent      → email + mot de passe
--     • /auth/connexion-backoffice → email + PIN
--   et les trois lectures par téléphone du logiciel filtrent déjà
--   `role = 'client'` :
--     • /auth/verifier-numero, /auth/connexion-client,
--       /auth/activer-compte
--   plus la résolution des lignes de paie (operationsService), elle
--   aussi bornée aux clients.
--
--   L'unicité qui compte — un numéro ne désigne qu'un seul client — est
--   donc préservée à l'identique. On la pose simplement là où elle a un
--   sens, au lieu de l'imposer à une table qui mélange deux populations
--   sans rapport.

ALTER TABLE users DROP CONSTRAINT users_phone_key;

-- Un numéro ne désigne qu'un seul CLIENT : c'est l'unicité qui porte
-- l'authentification, et elle reste entière.
CREATE UNIQUE INDEX users_phone_client_unique
  ON users (phone)
  WHERE role = 'client' AND phone IS NOT NULL;

-- Et un seul AGENT : deux agents qui partagent un numéro resterait une
-- erreur de saisie, même si rien ne s'y authentifie.
CREATE UNIQUE INDEX users_phone_agent_unique
  ON users (phone)
  WHERE role <> 'client' AND phone IS NOT NULL;
