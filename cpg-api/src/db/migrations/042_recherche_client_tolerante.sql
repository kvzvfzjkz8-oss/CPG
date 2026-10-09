-- ═══════════════════════════════════════════════════════════════════
--  RECHERCHE CLIENT TOLÉRANTE AUX FAUTES D'ORTHOGRAPHE
-- ═══════════════════════════════════════════════════════════════════
--
-- Au guichet, la caissière tape le nom que l'agent lui dit, pas celui
-- qui est écrit en base. Une seule lettre d'écart et la recherche ne
-- trouvait rien : « MOUNDELET » ne ramenait pas « MOUDELET Loic
-- Gypsy », et l'agent repartait sans son salaire alors que son compte
-- était approvisionné.
--
-- Les noms de ce portefeuille s'écrivent de plusieurs façons d'un
-- document à l'autre — MOUNDELET/MOUDELET, TCHIBINDA/TCHIBINGA,
-- BATOLO NAGA/BATOLO NGA — et la caissière n'a aucun moyen de deviner
-- laquelle a été saisie. La recherche doit donc être indulgente.
--
--   pg_trgm   : comparaison par trigrammes, qui rapproche deux chaînes
--               à une lettre près.
--   unaccent  : « Roméo » se trouve en tapant « Romeo ».
--
-- L'index GIN garde la recherche instantanée malgré la comparaison
-- floue : sans lui, chaque frappe parcourt toute la table des clients.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE INDEX IF NOT EXISTS users_full_name_trgm_idx
  ON users USING gin (full_name gin_trgm_ops);
