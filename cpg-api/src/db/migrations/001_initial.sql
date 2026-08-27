-- ═══════════════════════════════════════════════════════════════════
--  CPG — Schéma initial
-- ═══════════════════════════════════════════════════════════════════
--
--  Conventions :
--
--  • MONTANTS EN BIGINT, exprimés en francs CFA entiers.
--    Le XAF n'a pas de sous-unité : 1 FCFA est indivisible. On n'utilise
--    JAMAIS de type flottant pour de l'argent — 0.1 + 0.2 ≠ 0.3 en
--    virgule flottante, et sur un solde bancaire cela devient une perte
--    de fonds réelle.
--
--  • LE SOLDE N'EST PAS STOCKÉ comme un champ modifiable. Il se calcule
--    à partir du journal des écritures (table `ledger_entries`), qui est
--    en ajout seul. Une écriture erronée se corrige par une écriture
--    inverse, jamais par une suppression : c'est ce qui rend les comptes
--    auditables.
--
--  • TOUTE ACTION SENSIBLE EST TRACÉE dans `audit_log`. Exigence
--    réglementaire : on doit pouvoir répondre à « qui a approuvé ce
--    crédit, et quand ».

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Rôles ─────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('client', 'operateur', 'superviseur', 'admin');
CREATE TYPE user_status AS ENUM ('actif', 'suspendu', 'ferme');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_number   TEXT UNIQUE,               -- ex. CPG-00931, uniquement pour les clients
  full_name       TEXT NOT NULL,
  phone           TEXT UNIQUE NOT NULL,      -- identifiant de connexion côté mobile
  email           TEXT UNIQUE,               -- identifiant de connexion côté back-office
  employer        TEXT,                      -- ex. SETRAG
  job_title       TEXT,                      -- ex. Agent de la voie
  role            user_role NOT NULL DEFAULT 'client',
  status          user_status NOT NULL DEFAULT 'actif',

  -- Le code PIN n'est jamais stocké en clair. bcrypt, coût 12.
  pin_hash        TEXT,
  password_hash   TEXT,                      -- back-office uniquement
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role) WHERE status = 'actif';

-- ─── Comptes ───────────────────────────────────────────────────────
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  label       TEXT NOT NULL DEFAULT 'Compte principal',
  currency    CHAR(3) NOT NULL DEFAULT 'XAF',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_user ON accounts(user_id);

-- ─── Journal des écritures (append-only) ───────────────────────────
CREATE TYPE entry_type AS ENUM (
  'depot', 'retrait', 'paiement_credit', 'deblocage_credit', 'frais', 'ajustement'
);

CREATE TABLE ledger_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type         entry_type NOT NULL,

  -- Positif = crédit du compte, négatif = débit. Contrainte : jamais zéro.
  amount       BIGINT NOT NULL CHECK (amount <> 0),
  label        TEXT NOT NULL,
  reference    TEXT,                     -- réf. Mobile Money ou crédit lié
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_account_date ON ledger_entries(account_id, created_at DESC);

-- Solde courant, calculé et non stocké.
CREATE VIEW account_balances AS
SELECT a.id AS account_id,
       a.user_id,
       COALESCE(SUM(le.amount), 0)::BIGINT AS balance
FROM accounts a
LEFT JOIN ledger_entries le ON le.account_id = a.id
GROUP BY a.id, a.user_id;

-- ─── Crédits ───────────────────────────────────────────────────────
CREATE TYPE credit_status AS ENUM (
  'en_verification',   -- soumis par le client
  'valide_niveau1',    -- validé par un opérateur
  'approuve',          -- validé par un superviseur, fonds débloqués
  'rejete',
  'solde'              -- entièrement remboursé
);

CREATE TABLE credit_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT UNIQUE NOT NULL,            -- ex. CPG-4471
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount            BIGINT NOT NULL CHECK (amount > 0),
  duration_months   INT NOT NULL CHECK (duration_months BETWEEN 1 AND 60),
  monthly_rate      NUMERIC(6,4) NOT NULL,           -- ex. 0.0150 = 1,5 %/mois
  monthly_payment   BIGINT,                          -- calculé à l'approbation
  purpose           TEXT,
  status            credit_status NOT NULL DEFAULT 'en_verification',

  -- Traçabilité de la double validation exigée par le cahier des charges.
  level1_by         UUID REFERENCES users(id),
  level1_at         TIMESTAMPTZ,
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  rejected_by       UUID REFERENCES users(id),
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un superviseur ne peut pas approuver un dossier qu'il a lui-même
  -- validé en premier niveau : séparation des tâches.
  CONSTRAINT no_self_approval CHECK (level1_by IS NULL OR approved_by IS NULL OR level1_by <> approved_by)
);

CREATE INDEX idx_credits_status ON credit_requests(status, created_at DESC);
CREATE INDEX idx_credits_user ON credit_requests(user_id);

-- ─── Pièces justificatives ─────────────────────────────────────────
CREATE TYPE document_status AS ENUM ('attente', 'verifiee', 'refusee');

CREATE TABLE credit_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id    UUID NOT NULL REFERENCES credit_requests(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,             -- piece_identite, justificatif_revenu…
  storage_key  TEXT,                      -- clé dans le stockage objet, pas le fichier
  status       document_status NOT NULL DEFAULT 'attente',
  verified_by  UUID REFERENCES users(id),
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_credit ON credit_documents(credit_id);

-- ─── Échéancier ────────────────────────────────────────────────────
CREATE TYPE installment_status AS ENUM ('a_venir', 'payee', 'en_retard');

CREATE TABLE installments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id     UUID NOT NULL REFERENCES credit_requests(id) ON DELETE CASCADE,
  sequence      INT NOT NULL,             -- 1..duration_months
  due_date      DATE NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  status        installment_status NOT NULL DEFAULT 'a_venir',
  paid_at       TIMESTAMPTZ,
  ledger_entry_id UUID REFERENCES ledger_entries(id),

  UNIQUE (credit_id, sequence)
);

CREATE INDEX idx_installments_due ON installments(due_date) WHERE status <> 'payee';

-- ─── Transactions Mobile Money ─────────────────────────────────────
CREATE TYPE momo_operator AS ENUM ('airtel', 'moov');
CREATE TYPE momo_direction AS ENUM ('entrant', 'sortant');
CREATE TYPE momo_status AS ENUM ('initiee', 'en_attente', 'confirmee', 'echouee', 'annulee');

CREATE TABLE momo_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT UNIQUE NOT NULL,          -- ex. TX-9021
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  operator          momo_operator NOT NULL,
  direction         momo_direction NOT NULL,
  amount            BIGINT NOT NULL CHECK (amount > 0),
  phone             TEXT NOT NULL,
  status            momo_status NOT NULL DEFAULT 'initiee',
  operator_ref      TEXT,                          -- identifiant côté opérateur
  failure_reason    TEXT,

  -- Empêche le double débit si l'app renvoie la même requête après un
  -- timeout réseau. Le client génère la clé, le serveur la refuse en double.
  idempotency_key   TEXT UNIQUE,

  ledger_entry_id   UUID REFERENCES ledger_entries(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at      TIMESTAMPTZ
);

CREATE INDEX idx_momo_user ON momo_transactions(user_id, created_at DESC);
CREATE INDEX idx_momo_status ON momo_transactions(status, created_at DESC);

-- ─── Messagerie ────────────────────────────────────────────────────
CREATE TABLE conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advisor_id   UUID REFERENCES users(id),
  last_message_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES users(id),
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);

-- ─── Appareils (notifications push) ────────────────────────────────
CREATE TABLE devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token    TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un même téléphone réinstallé garde son token : on met à jour au lieu
  -- de créer un doublon, sinon le client reçoit chaque alerte deux fois.
  UNIQUE (user_id, push_token)
);

CREATE INDEX idx_devices_user ON devices(user_id);

-- ─── Notifications envoyées ────────────────────────────────────────
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,            -- credit_approuve, momo_confirme…
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered   BOOLEAN NOT NULL DEFAULT false,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- ─── Sessions (jetons de rafraîchissement) ─────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,            -- le jeton lui-même n'est pas stocké
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ─── Journal d'audit ───────────────────────────────────────────────
-- Append-only. Aucune route ne doit exposer de DELETE sur cette table.
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     UUID REFERENCES users(id),
  actor_role   user_role,
  action       TEXT NOT NULL,           -- credit.approuve, utilisateur.suspendu…
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ─── Mise à jour automatique de updated_at ─────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER credits_touch BEFORE UPDATE ON credit_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
