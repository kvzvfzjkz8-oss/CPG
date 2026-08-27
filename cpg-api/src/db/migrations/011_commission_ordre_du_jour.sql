-- ─────────────────────────────────────────────────────────────────────
--  ORDRE DU JOUR DU COMITÉ — AU-DELÀ DES NOUVEAUX CRÉDITS
-- ─────────────────────────────────────────────────────────────────────
--
-- « Cette commission statue sur tous les types de crédits. Dossiers en
--   difficultés ou demande exceptionnelle, etc. »
--
-- Le circuit nouveau_credit (déjà en place, porté directement par les
-- colonnes commission_* de credit_requests) reste inchangé : c'est le
-- plus fréquent et il est déjà entièrement testé. Cette table couvre
-- les deux autres natures de dossiers que la même séance doit aussi
-- trancher, sans dupliquer ce qui existe déjà :
--
--   • dossier_difficulte : un crédit ACTIF qui pose problème (retard
--     de paiement, situation du client…) — la commission décide d'une
--     orientation ; l'action concrète (décaler une échéance, etc.) se
--     fait ensuite via les outils déjà en place, sur décision du comité.
--   • demande_exceptionnelle : une demande qui n'est pas forcément
--     liée à un crédit précis (client_id seul, ou aucun des deux pour
--     une question purement interne).
CREATE TYPE commission_item_type AS ENUM ('dossier_difficulte', 'demande_exceptionnelle');
CREATE TYPE commission_item_status AS ENUM ('en_attente', 'valide', 'rejete');

CREATE TABLE commission_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES commission_sessions(id),
  type           commission_item_type NOT NULL,
  credit_id      UUID REFERENCES credit_requests(id),
  client_id      UUID REFERENCES users(id),
  titre          TEXT NOT NULL,
  note           TEXT,
  status         commission_item_status NOT NULL DEFAULT 'en_attente',

  deposited_by   UUID NOT NULL REFERENCES users(id),
  deposited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_by    UUID REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,

  -- Rattaché à quelque chose de concret : un dossier de crédit, un
  -- client, ou les deux — jamais un point d'ordre du jour flottant
  -- qu'on ne pourrait pas retrouver ensuite.
  CONSTRAINT commission_item_rattache CHECK (credit_id IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX idx_commission_items_session ON commission_items(session_id) WHERE status = 'en_attente';
