-- ═══════════════════════════════════════════════════════════════════
--  002 — Ajout du rôle Directeur
-- ═══════════════════════════════════════════════════════════════════
--
--  Migration isolée et SANS bloc transactionnel, volontairement.
--
--  PostgreSQL refuse ALTER TYPE ... ADD VALUE à l'intérieur d'une
--  transaction sur les versions anciennes, et interdit d'utiliser la
--  nouvelle valeur dans la même transaction que son ajout, même sur
--  les versions récentes. Regrouper cet ajout avec la création des
--  tables ferait échouer la migration.
--
--  D'où la séparation : ce fichier ne fait que déclarer le rôle,
--  le suivant crée le catalogue.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'directeur';
