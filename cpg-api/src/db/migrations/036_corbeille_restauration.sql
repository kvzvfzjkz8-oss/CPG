-- Corbeille : chaque suppression (client ou crédit) doit pouvoir être
-- consultée ET restaurée par le directeur, pas seulement archivée.
-- On ajoute donc de quoi savoir ce qu'il faut remettre en place, et
-- une trace de la restauration une fois faite.

ALTER TABLE client_deletion_reports
  ADD COLUMN restored_at TIMESTAMPTZ,
  ADD COLUMN restored_by UUID REFERENCES users(id);

ALTER TABLE credit_deletion_reports
  ADD COLUMN restored_at TIMESTAMPTZ,
  ADD COLUMN restored_by UUID REFERENCES users(id),
  -- Statut du crédit juste avant la suppression, pour savoir où le
  -- remettre : 'valide_commission' / 'valide_double' pour un dossier
  -- supprimé avant déblocage des fonds, 'approuve' / 'suspendu' pour
  -- un crédit actif supprimé par erreur.
  ADD COLUMN previous_status TEXT,
  -- 'double_validation' : dossier supprimé avant tout déblocage de
  --   fonds (double validation opérateur ou approbation finale
  --   directeur) — restauration = remettre le statut, rien d'autre.
  -- 'credit_actif' : crédit déjà débloqué, supprimé en erreur — les
  --   écritures de déblocage/frais avaient été extournées ;
  --   restauration = contre-extourner (nouvelles écritures) et remettre
  --   le statut.
  ADD COLUMN type TEXT NOT NULL DEFAULT 'double_validation'
    CHECK (type IN ('double_validation', 'credit_actif'));
