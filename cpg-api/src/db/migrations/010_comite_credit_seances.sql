-- ─── Séances de commission ──────────────────────────────────────────
-- « Une commission doit être tenue chaque semaine. Le superviseur est
--   celui qui est à même de programmer une commission. »
-- Une seule séance « planifiee » à la fois : l'index unique partiel
-- ci-dessous l'impose — il faut tenir ou annuler la séance en cours
-- avant d'en programmer une autre.
CREATE TYPE commission_session_status AS ENUM ('planifiee', 'tenue', 'annulee');

CREATE TABLE commission_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for  TIMESTAMPTZ NOT NULL,
  status         commission_session_status NOT NULL DEFAULT 'planifiee',
  scheduled_by   UUID NOT NULL REFERENCES users(id),
  held_by        UUID REFERENCES users(id),
  held_at        TIMESTAMPTZ,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_commission_sessions_one_planned
  ON commission_sessions(status) WHERE status = 'planifiee';

-- ─── Traçabilité sur le dossier de crédit lui-même ──────────────────
-- « Le gestionnaire dépose les demandes de crédit dans l'onglet
--   commission afin que le superviseur analyse et fasse des
--   modifications avant que la commission ne se tienne. »
-- commission_note porte cette analyse ; les colonnes de décision et de
-- double validation complètent le circuit jusqu'à l'octroi final.
ALTER TABLE credit_requests
  ADD COLUMN commission_session_id   UUID REFERENCES commission_sessions(id),
  ADD COLUMN commission_note         TEXT,
  ADD COLUMN commission_decision_by  UUID REFERENCES users(id),
  ADD COLUMN commission_decided_at   TIMESTAMPTZ,
  ADD COLUMN commission_decision_note TEXT,
  ADD COLUMN double_validated_by     UUID REFERENCES users(id),
  ADD COLUMN double_validated_at     TIMESTAMPTZ;

-- ─── Autorisation spéciale du directeur ─────────────────────────────
-- « Un agent qui a un crédit en cours ne peut plus obtenir un nouveau
--   crédit en commission à moins d'avoir une autorisation spéciale du
--   Directeur. » Une autorisation se consomme une fois, sur un dossier
--   précis — elle ne rouvre pas un accès permanent au contournement.
CREATE TABLE commission_exception_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id     UUID NOT NULL REFERENCES users(id),
  motif              TEXT NOT NULL,
  granted_by         UUID NOT NULL REFERENCES users(id),
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at            TIMESTAMPTZ,
  used_for_credit_id UUID REFERENCES credit_requests(id)
);

CREATE INDEX idx_commission_exceptions_unused
  ON commission_exception_authorizations(client_user_id) WHERE used_at IS NULL;
