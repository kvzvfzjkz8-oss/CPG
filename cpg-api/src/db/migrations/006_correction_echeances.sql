-- ─── Lien d'annulation ──────────────────────────────────────────────
-- Une transaction annulée reçoit une écriture inverse qui pointe vers
-- elle. reversed_entry_id permet de retrouver l'original depuis
-- l'extourne, et surtout d'empêcher qu'une même écriture soit annulée
-- deux fois (on vérifie qu'aucune autre ligne ne la référence déjà).
ALTER TABLE ledger_entries
  ADD COLUMN reversed_entry_id UUID REFERENCES ledger_entries(id);

CREATE INDEX idx_ledger_reversed ON ledger_entries(reversed_entry_id) WHERE reversed_entry_id IS NOT NULL;

-- ─── Historique des corrections d'échéance ──────────────────────────
-- Modifier la date ou le montant d'une échéance pas encore prélevée
-- doit rester traçable : qui, quand, l'ancienne valeur. Le journal
-- d'audit (audit_log) porte déjà l'action elle-même ; ces deux colonnes
-- gardent la valeur d'origine directement sur la ligne concernée, pour
-- qu'un coup d'œil sur l'échéancier suffise à voir qu'elle a été
-- corrigée, sans devoir croiser avec le journal d'audit.
ALTER TABLE installments
  ADD COLUMN original_due_date DATE,
  ADD COLUMN adjusted_by UUID REFERENCES users(id),
  ADD COLUMN adjusted_at TIMESTAMPTZ;
