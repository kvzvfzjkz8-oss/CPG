-- ═══════════════════════════════════════════════════════════════════
--  019 — Mode de paiement d'un retrait guichet
-- ═══════════════════════════════════════════════════════════════════
--
--  Un retrait client ne se fait pas forcément en espèces : la
--  caissière peut aussi payer via Airtel Money ou Moov Money vers le
--  numéro du client. Dans tous les cas, c'est toujours SA caisse qui
--  en porte la responsabilité et diminue d'autant — seule la manière
--  dont l'argent arrive au client change.

CREATE TYPE caisse_mode_paiement AS ENUM ('especes', 'airtel', 'moov');

ALTER TABLE caisse_operations
  ADD COLUMN mode_paiement caisse_mode_paiement NOT NULL DEFAULT 'especes',
  ADD COLUMN telephone_paiement TEXT,
  ADD COLUMN momo_transaction_id UUID REFERENCES momo_transactions(id);
