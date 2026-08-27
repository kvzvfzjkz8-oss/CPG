-- ─────────────────────────────────────────────────────────────────────
--  COMITÉ DE CRÉDIT ("COMMISSION") — NOUVELLE ÉTAPE OBLIGATOIRE
-- ─────────────────────────────────────────────────────────────────────
--
-- « Tous ces crédits doivent être présentés en comité et validés. »
-- Le circuit devient : en_verification → valide_niveau1 →
-- en_attente_commission → valide_commission (ou rejete) →
-- valide_double → approuve. Trois nouvelles étapes s'insèrent entre la
-- validation de premier niveau (déjà en place) et l'octroi final.
--
-- Isolée dans son propre fichier, comme toujours pour ALTER TYPE ADD
-- VALUE : cette commande ne peut pas être utilisée dans la même
-- transaction qu'une commande qui s'en sert ensuite.

ALTER TYPE credit_status ADD VALUE 'en_attente_commission';
ALTER TYPE credit_status ADD VALUE 'valide_commission';
ALTER TYPE credit_status ADD VALUE 'valide_double';
