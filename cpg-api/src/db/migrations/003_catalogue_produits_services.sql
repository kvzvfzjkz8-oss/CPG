-- ═══════════════════════════════════════════════════════════════════
--  003 — Catalogue des produits, services annexes et agios
-- ═══════════════════════════════════════════════════════════════════


BEGIN;

-- ═══════════════════════════════════════════════════════════════════
--  CATALOGUE DES PRODUITS DE CRÉDIT
-- ═══════════════════════════════════════════════════════════════════

CREATE TYPE product_status AS ENUM ('brouillon', 'actif', 'suspendu', 'archive');

CREATE TABLE credit_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,          -- MICRO_STD, CHEMINOT, EXPRESS…
  name          TEXT NOT NULL,                 -- « Microcrédit cheminot »
  description   TEXT,
  status        product_status NOT NULL DEFAULT 'brouillon',

  -- Un produit ne devient utilisable qu'une fois activé par le
  -- directeur : un brouillon mal réglé ne doit pas se retrouver
  -- proposé aux clients par accident.
  created_by    UUID REFERENCES users(id),
  activated_by  UUID REFERENCES users(id),
  activated_at  TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_status ON credit_products(status);

-- ─── Versions de barème ────────────────────────────────────────────
CREATE TABLE product_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES credit_products(id) ON DELETE CASCADE,
  version           INT NOT NULL,

  -- Barème
  monthly_rate      NUMERIC(6,4) NOT NULL CHECK (monthly_rate >= 0),
  min_amount        BIGINT NOT NULL CHECK (min_amount > 0),
  max_amount        BIGINT NOT NULL,
  min_duration      INT NOT NULL CHECK (min_duration >= 1),
  max_duration      INT NOT NULL,

  -- Frais de dossier : montant fixe et/ou pourcentage du capital.
  file_fee_fixed    BIGINT NOT NULL DEFAULT 0 CHECK (file_fee_fixed >= 0),
  file_fee_rate     NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (file_fee_rate >= 0),

  -- Pénalité de retard, en pourcentage de l'échéance impayée par mois.
  late_penalty_rate NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (late_penalty_rate >= 0),

  -- Période de validité. effective_to NULL = version en vigueur.
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to      TIMESTAMPTZ,

  created_by        UUID REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  note              TEXT,                      -- motif du changement de barème
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (product_id, version),
  CHECK (max_amount >= min_amount),
  CHECK (max_duration >= min_duration),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_versions_product ON product_versions(product_id, version DESC);

-- Une seule version en vigueur par produit à un instant donné.
CREATE UNIQUE INDEX idx_versions_current
  ON product_versions(product_id)
  WHERE effective_to IS NULL;

-- Vue de confort : le barème applicable aujourd'hui.
CREATE VIEW current_product_versions AS
SELECT p.id AS product_id, p.code, p.name, p.status,
       v.id AS version_id, v.version, v.monthly_rate,
       v.min_amount, v.max_amount, v.min_duration, v.max_duration,
       v.file_fee_fixed, v.file_fee_rate, v.late_penalty_rate,
       v.effective_from
FROM credit_products p
JOIN product_versions v ON v.product_id = p.id AND v.effective_to IS NULL;

-- ─── Rattachement des crédits au barème signé ──────────────────────
ALTER TABLE credit_requests
  ADD COLUMN product_version_id UUID REFERENCES product_versions(id),
  ADD COLUMN file_fee BIGINT NOT NULL DEFAULT 0;

CREATE INDEX idx_credits_version ON credit_requests(product_version_id);

-- ═══════════════════════════════════════════════════════════════════
--  SERVICES ANNEXES ET AGIOS
-- ═══════════════════════════════════════════════════════════════════
--
--  « Agios » recouvre ici les intérêts débiteurs sur solde négatif,
--  les commissions de mouvement et les frais de tenue de compte.
--  Chacun est un service paramétrable, versionné comme les produits.

CREATE TYPE fee_basis AS ENUM (
  'fixe',              -- montant forfaitaire
  'pourcentage',       -- % du montant de l'opération
  'journalier_solde'   -- taux appliqué au solde débiteur, par jour (agios)
);

CREATE TYPE fee_trigger AS ENUM (
  'retrait', 'depot', 'transfert_momo', 'tenue_compte',
  'solde_debiteur', 'retard_echeance', 'manuel'
);

CREATE TABLE fee_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,           -- AGIOS_DECOUVERT, FRAIS_TENUE…
  name         TEXT NOT NULL,
  description  TEXT,
  basis        fee_basis NOT NULL,
  trigger_on   fee_trigger NOT NULL,
  status       product_status NOT NULL DEFAULT 'brouillon',
  created_by   UUID REFERENCES users(id),
  activated_by UUID REFERENCES users(id),
  activated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fee_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_id          UUID NOT NULL REFERENCES fee_definitions(id) ON DELETE CASCADE,
  version         INT NOT NULL,

  amount          BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),   -- si basis = fixe
  rate            NUMERIC(8,6) NOT NULL DEFAULT 0 CHECK (rate >= 0), -- si % ou journalier

  -- Bornes : protègent le client des frais disproportionnés sur les
  -- petits comptes, et l'établissement des erreurs de saisie.
  min_amount      BIGINT NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  max_amount      BIGINT,
  exempt_below    BIGINT NOT NULL DEFAULT 0,   -- pas de frais sous ce seuil

  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to    TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (fee_id, version),
  CHECK (max_amount IS NULL OR max_amount >= min_amount),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX idx_fee_versions_current
  ON fee_versions(fee_id) WHERE effective_to IS NULL;

CREATE VIEW current_fee_versions AS
SELECT f.id AS fee_id, f.code, f.name, f.basis, f.trigger_on, f.status,
       v.id AS version_id, v.version, v.amount, v.rate,
       v.min_amount, v.max_amount, v.exempt_below, v.effective_from
FROM fee_definitions f
JOIN fee_versions v ON v.fee_id = f.id AND v.effective_to IS NULL;

-- ─── Frais effectivement prélevés ──────────────────────────────────
CREATE TABLE applied_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_version_id  UUID NOT NULL REFERENCES fee_versions(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  basis_detail    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- comment le calcul a été fait
  period_start    DATE,
  period_end      DATE,
  ledger_entry_id UUID REFERENCES ledger_entries(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Empêche de prélever deux fois les mêmes agios sur la même période
  -- si la tâche planifiée est relancée par erreur.
  UNIQUE (fee_version_id, account_id, period_start, period_end)
);

CREATE INDEX idx_applied_fees_account ON applied_fees(account_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
--  DEMANDES DE CHANGEMENT DE BARÈME
-- ═══════════════════════════════════════════════════════════════════
--
--  Le gestionnaire ajuste librement dans les marges déléguées par la
--  direction. Au-delà, il propose et le directeur tranche. Un taux
--  engage l'établissement sur des années : la double signature est la
--  même logique que la double validation des crédits.

CREATE TYPE change_status AS ENUM ('en_attente', 'approuve', 'rejete');

CREATE TABLE rate_change_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   TEXT NOT NULL CHECK (target_type IN ('produit', 'service')),
  target_id     UUID NOT NULL,
  payload       JSONB NOT NULL,              -- nouveau barème proposé
  reason        TEXT NOT NULL,
  status        change_status NOT NULL DEFAULT 'en_attente',

  requested_by  UUID NOT NULL REFERENCES users(id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,

  -- Séparation des tâches : le proposant ne peut pas être le décideur.
  CONSTRAINT no_self_decision CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX idx_rate_changes_status ON rate_change_requests(status, requested_at DESC);

-- ─── Plafonds réglementaires ───────────────────────────────────────
-- Garde-fou matériel contre l'erreur de saisie : sans plafond en base,
-- un zéro de trop crée un prêt à 150 %/mois qu'aucune relecture humaine
-- ne rattrapera après signature.
CREATE TABLE rate_ceilings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT UNIQUE NOT NULL,        -- credit_monthly, agios_daily…
  max_rate      NUMERIC(8,6) NOT NULL CHECK (max_rate > 0),
  note          TEXT,
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rate_ceilings (scope, max_rate, note) VALUES
  ('credit_monthly', 0.0300, 'Plafond interne du taux mensuel de crédit. À aligner sur le taux d''usure BEAC en vigueur.'),
  ('agios_daily',    0.0010, 'Plafond du taux journalier d''agios sur solde débiteur.'),
  ('fee_percentage', 0.0500, 'Plafond des commissions exprimées en pourcentage.');

CREATE TRIGGER products_touch BEFORE UPDATE ON credit_products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER fees_touch BEFORE UPDATE ON fee_definitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
