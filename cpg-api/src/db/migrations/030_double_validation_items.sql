-- ═══════════════════════════════════════════════════════════════════
--  030 — Double validation des dossiers en difficulté / demandes
--         exceptionnelles, par l'opérateur
-- ═══════════════════════════════════════════════════════════════════
--
--  Même circuit que pour un crédit normal : le directeur tranche en
--  séance, puis l'opérateur double-valide avant que ce soit considéré
--  comme traité. Auparavant, valider un dossier en difficulté en
--  séance n'entraînait aucune suite — plus rien à faire côté
--  opérateur, ce qui n'était pas ce qui était voulu.

ALTER TYPE commission_item_status ADD VALUE IF NOT EXISTS 'valide_double';

ALTER TABLE commission_items ADD COLUMN double_validated_by UUID REFERENCES users(id);
ALTER TABLE commission_items ADD COLUMN double_validated_at TIMESTAMPTZ;
