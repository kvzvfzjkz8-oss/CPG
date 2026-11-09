-- ═══════════════════════════════════════════════════════════════════
--  061 — GESTION DES CRÉDITS : LE GESTIONNAIRE PROPOSE, L'OPÉRATEUR
--         DONNE SON ACCORD, LE DIRECTEUR VALIDE
-- ═══════════════════════════════════════════════════════════════════
--
-- « Il faut créer un onglet pour le gestionnaire et le directeur qui
--   s'appelle "gestion des crédits". Dans cet onglet le gestionnaire
--   aura la possibilité de modifier un crédit : changer les dates de
--   prélèvements avec accord préalable de l'opérateur puis validation
--   du directeur, demander un prélèvement supplémentaire avec
--   validation de l'opérateur puis du directeur, supprimer un crédit,
--   ou encore modifier le montant du crédit. »
--   « À ajouter aussi la modification des taux pour certains crédits en
--   cours, ou sauter un mois de prélèvement pour certains clients étant
--   en difficulté. » (direction, 09/11/2026)
--
-- Jusqu'ici le gestionnaire ne pouvait rien engager sur un crédit déjà
-- accordé : tout partait de l'opérateur, qui proposait au directeur.
-- Deux maillons, deux personnes. La direction en veut TROIS, et dans
-- cet ordre : le gestionnaire connaît le client et propose, l'opérateur
-- vérifie que c'est tenable au guichet, le directeur engage la maison.
--
-- D'où un cycle de vie à deux décisions, et non une :
--
--   en_attente_operateur  --(accord)-->  en_attente_directeur
--          |                                     |
--          +--(refus)--> rejete <---(refus)-------+
--                                                 |
--                                    (validation) +--> approuve
--                                                        |
--                                                  l'effet s'applique
--
-- UNE SEULE TABLE POUR LES QUATRE NATURES
--   Les quatre demandes partagent le même circuit et les mêmes
--   écrans ; les séparer en quatre tables aurait quadruplé le code de
--   validation et les vues pour une différence qui tient dans un
--   champ. Ce qui varie d'une nature à l'autre est dans `details`,
--   en JSONB, et la contrainte ci-dessous impose à chacune les clés
--   qu'elle doit porter — une demande incomplète est refusée par la
--   base, pas seulement par l'API.
--
-- LA SUPPRESSION RESTE OÙ ELLE EST
--   `credit_deletion_requests` (migration 039) continue de servir : ce
--   circuit fonctionne, il est éprouvé, et le refaire aurait mis en
--   péril une fonction qui marche. Le nouvel onglet l'affiche à côté
--   des autres, c'est la demande de la direction — regrouper les
--   écrans, pas réécrire la plomberie.

CREATE TYPE credit_modification_kind AS ENUM (
  'dates_echeances',             -- changer le jour de prélèvement
  'prelevement_supplementaire',  -- encaisser une mensualité de plus
  'report_echeance',             -- sauter un mois, client en difficulté
  'taux',                        -- réviser le taux d'un crédit en cours
  'montant'                      -- appliquer un dépôt anticipé au capital
);

CREATE TYPE credit_modification_status AS ENUM (
  'en_attente_operateur',
  'en_attente_directeur',
  'approuve',
  'rejete'
);

CREATE TABLE credit_modification_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id       UUID NOT NULL REFERENCES credit_requests(id),
  kind            credit_modification_kind NOT NULL,
  motif           TEXT NOT NULL,
  status          credit_modification_status NOT NULL DEFAULT 'en_attente_operateur',

  -- Ce qui change d'une nature à l'autre.
  --   dates_echeances            : { "jour": 4 }
  --   prelevement_supplementaire : { "installment_id": … }
  --   report_echeance            : { "mois": 1 }
  --   taux                       : { "taux_mensuel": 0.05 }
  --   montant                    : { "montant_depose": 150000 }
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Ce que l'application a réellement fait, écrit au moment de
  -- l'approbation : sans cette trace, on sait qu'une demande a été
  -- approuvée mais plus ce qu'elle a produit.
  effet           JSONB,

  requested_by    UUID NOT NULL REFERENCES users(id),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  accord_par      UUID REFERENCES users(id),
  accord_le       TIMESTAMPTZ,
  accord_note     TEXT,

  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,

  -- Séparation des tâches, imposée en base et pas seulement côté API :
  -- personne ne valide sa propre demande, à aucune des deux étapes.
  CONSTRAINT no_self_accord_modif
    CHECK (accord_par IS NULL OR accord_par <> requested_by),
  CONSTRAINT no_self_decision_modif
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- Le directeur ne tranche jamais avant l'accord de l'opérateur :
  -- l'ordre des maillons est la demande de la direction, et il ne doit
  -- pas dépendre de l'ordre dans lequel les écrans sont cliqués.
  CONSTRAINT accord_avant_decision
    CHECK (decided_at IS NULL OR accord_le IS NOT NULL),

  -- Chaque nature porte les clés qu'il lui faut. Une demande de
  -- prélèvement supplémentaire sans échéance désignée, ou un
  -- changement de montant sans montant, n'a aucun sens : autant la
  -- refuser à l'écriture plutôt que de la découvrir à l'approbation.
  CONSTRAINT details_complets CHECK (
    CASE kind
      WHEN 'prelevement_supplementaire' THEN details ? 'installment_id'
      WHEN 'montant' THEN details ? 'montant_depose'
      WHEN 'dates_echeances' THEN details ? 'jour'
      WHEN 'report_echeance' THEN details ? 'mois'
      WHEN 'taux' THEN details ? 'taux_mensuel'
    END
  )
);

CREATE INDEX idx_credit_modifications_status
  ON credit_modification_requests(status, requested_at DESC);
CREATE INDEX idx_credit_modifications_credit
  ON credit_modification_requests(credit_id, requested_at DESC);

-- Une seule demande en cours à la fois par crédit ET par nature. Deux
-- changements de date concurrents sur le même dossier, et plus personne
-- ne sait lequel le directeur arbitre — c'est la leçon de l'index
-- équivalent sur les corrections d'échéances (migration 007). En
-- revanche un changement de date et un prélèvement supplémentaire
-- peuvent coexister : ils ne se contredisent pas.
CREATE UNIQUE INDEX idx_credit_modifications_en_cours
  ON credit_modification_requests(credit_id, kind)
  WHERE status IN ('en_attente_operateur', 'en_attente_directeur');
