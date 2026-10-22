-- ═══════════════════════════════════════════════════════════════════
--  AJUSTEMENT D'UN DOSSIER EN COMMISSION
-- ═══════════════════════════════════════════════════════════════════
--
-- « Je vais modifier les montants demain en commission. Il faut que tu
--   me mettes cette capacité, c'est-à-dire la capacité de modifier les
--   requêtes des gestionnaires et valider. »
--
-- C'est ce que prévoyait déjà le cahier des charges à la création du
-- comité : « le gestionnaire dépose les demandes de crédit dans
-- l'onglet commission afin que le superviseur analyse et fasse des
-- modifications avant que la commission ne se tienne » (migration
-- 010). Seule l'annotation avait été implémentée — commission_note.
-- Le montant lui-même restait figé sur la demande du client.
--
-- Un comité de crédit qui ne peut pas réduire un montant n'a que deux
-- réponses : tout accorder ou tout refuser. C'est précisément ce que
-- l'enveloppe plafonnée rend intenable : plutôt que d'écarter un bon
-- dossier faute de place, on l'ajuste.
--
-- ─── Ce qui est conservé ───────────────────────────────────────────
--
-- Le montant et la durée D'ORIGINE, c'est-à-dire ce que le client a
-- demandé. Sans eux, un dossier ajusté devient indistinguable d'un
-- dossier accordé tel quel, et plus personne ne peut dire si le client
-- a obtenu ce qu'il voulait. Ils ne sont écrits qu'au PREMIER
-- ajustement : plusieurs retouches successives ne doivent pas écraser
-- la demande initiale par l'avant-dernière version.
--
-- Comme partout ailleurs ici, on n'efface pas : la demande du client
-- reste lisible à côté de ce que le comité a décidé.

ALTER TABLE credit_requests
  ADD COLUMN IF NOT EXISTS amount_initial    BIGINT,
  ADD COLUMN IF NOT EXISTS duration_initial  INT,
  ADD COLUMN IF NOT EXISTS ajuste_par        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS ajuste_le         TIMESTAMPTZ;

ALTER TABLE credit_requests
  DROP CONSTRAINT IF EXISTS credit_requests_ajustement_check;

-- Un ajustement est tracé entièrement ou pas du tout : un montant
-- d'origine sans auteur ni date serait inexploitable en contrôle.
ALTER TABLE credit_requests
  ADD CONSTRAINT credit_requests_ajustement_check CHECK (
    (amount_initial IS NULL AND duration_initial IS NULL
     AND ajuste_par IS NULL AND ajuste_le IS NULL)
    OR
    (amount_initial IS NOT NULL AND duration_initial IS NOT NULL
     AND ajuste_par IS NOT NULL AND ajuste_le IS NOT NULL)
  );

COMMENT ON COLUMN credit_requests.amount_initial IS
  'Montant demandé par le client, avant ajustement en commission. NULL = jamais ajusté.';
COMMENT ON COLUMN credit_requests.duration_initial IS
  'Durée demandée par le client, avant ajustement en commission. NULL = jamais ajustée.';
